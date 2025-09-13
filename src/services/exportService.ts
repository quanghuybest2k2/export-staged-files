import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { createHash } from 'crypto';
import { GitService } from './gitService';

export class ExportService {
  async exportChangedFiles(customFolderName?: string) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }

    const workspacePath = workspaceFolder.uri.fsPath;
    const projectName = customFolderName || path.basename(workspacePath);
    const cfg = vscode.workspace.getConfiguration('exportStagedFiles');
    const outputFormat = cfg.get<'folder' | 'zip' | 'tar.gz'>(
      'outputFormat',
      'folder',
    );
    const nameTemplate = cfg.get<string>(
      'nameTemplate',
      '{project}-{branch}-{timestamp}',
    );
    const includeManifest = cfg.get<boolean>('includeManifest', false);

    try {
      const git = new GitService(workspacePath);
      const branch = await this.safeGit(() =>
        this.getBranchName(workspacePath),
      );
      const hash = await this.safeGit(() => this.getShortHash(workspacePath));
      const user = await this.safeGit(() => this.getUserName(workspacePath));
      const timestamp = this.makeTimestamp();
      const exportBaseName = this.applyTemplate(nameTemplate, {
        project: projectName,
        branch: branch || 'no-branch',
        hash: hash || 'no-hash',
        user: user || 'unknown',
        timestamp,
      });

      const defaultDir = path.join(require('os').homedir(), 'Desktop');
      const defaultPath = path.join(
        defaultDir,
        exportBaseName +
          (outputFormat === 'folder'
            ? ''
            : outputFormat === 'zip'
              ? '.zip'
              : '.tar.gz'),
      );

      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultPath),
        filters:
          outputFormat === 'folder'
            ? { Folder: ['*'] }
            : outputFormat === 'zip'
              ? { Zip: ['zip'] }
              : { 'GZip Tarball': ['gz'] },
        saveLabel:
          outputFormat === 'folder'
            ? 'Select Export Folder Location'
            : 'Select Archive Location',
      });

      if (!saveUri) {
        return; // cancelled
      }

      let exportPath = saveUri.fsPath;
      // Normalize name if user provided folder without name in folder mode
      const targetIsArchive = outputFormat !== 'folder';
      if (targetIsArchive) {
        if (
          outputFormat === 'zip' &&
          !exportPath.toLowerCase().endsWith('.zip')
        ) {
          exportPath += '.zip';
        }
        if (
          outputFormat === 'tar.gz' &&
          !exportPath.toLowerCase().endsWith('.tar.gz')
        ) {
          exportPath += '.tar.gz';
        }
      }

      let didExport = false;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Exporting changed files...',
          cancellable: false,
        },
        async (progress) => {
          progress.report({
            increment: 5,
            message: 'Getting changed files...',
          });

          const changes = await git.getChangedFiles();
          const files = Array.from(
            new Set([
              ...changes.staged,
              ...changes.modified,
              ...changes.untracked,
            ]),
          ).filter(Boolean);

          if (files.length === 0) {
            vscode.window.showWarningMessage('No changed files found');
            return;
          }

          progress.report({
            increment: 15,
            message: `Found ${files.length} changed files`,
          });

          // Prepare temp folder (even for archives we stage files into a temp dir)
          const tempDir = await fs.promises.mkdtemp(
            path.join(require('os').tmpdir(), 'export-staged-'),
          );
          const contentDir = path.join(tempDir, exportBaseName);
          await fs.promises.mkdir(contentDir, { recursive: true });

          progress.report({
            increment: 20,
            message: 'Creating folder structure...',
          });

          // Copy files
          const manifestEntries: Array<{
            path: string;
            size: number;
            sha256: string | null;
          }> = [];
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const sourcePath = path.join(workspacePath, file);
            const targetPath = path.join(contentDir, file);
            const targetDir = path.dirname(targetPath);

            try {
              await fs.promises.mkdir(targetDir, { recursive: true });
              if (fs.existsSync(sourcePath)) {
                const stats = await fs.promises.stat(sourcePath);
                if (stats.isFile()) {
                  await fs.promises.copyFile(sourcePath, targetPath);
                  const sha = await this.sha256File(sourcePath).catch(
                    () => null,
                  );
                  manifestEntries.push({
                    path: file,
                    size: stats.size,
                    sha256: sha,
                  });
                }
              }
            } catch (fileError) {
              console.warn(`Failed to copy file ${file}:`, fileError);
            }

            progress.report({
              increment: 0,
              message: `Copying files... (${i + 1}/${files.length})`,
            });
          }

          // Write manifest and export-info into content root
          if (includeManifest) {
            const exportInfo = {
              name: exportBaseName,
              projectName,
              branch,
              commitHash: hash,
              user,
              exportDate: new Date().toISOString(),
              totalFiles: files.length,
              stagedFiles: changes.staged.length,
              modifiedFiles: changes.modified.length,
              untrackedFiles: changes.untracked.length,
              files: manifestEntries,
            };
            await fs.promises.writeFile(
              path.join(contentDir, 'manifest.json'),
              JSON.stringify(exportInfo, null, 2),
              'utf8',
            );
          }

          // Deliver to user-selected destination
          if (targetIsArchive) {
            progress.report({
              increment: 10,
              message: `Creating ${outputFormat} archive...`,
            });
            await this.createArchive(contentDir, exportPath, outputFormat);
          } else {
            // If user selected a path that already exists, clean it; otherwise create
            if (fs.existsSync(exportPath)) {
              await fs.promises.rm(exportPath, {
                recursive: true,
                force: true,
              });
            }
            await fs.promises.mkdir(exportPath, { recursive: true });
            await this.copyDirectory(contentDir, exportPath);
          }

          // Cleanup temp
          await fs.promises.rm(tempDir, { recursive: true, force: true });

          progress.report({ increment: 100, message: 'Export completed!' });
          didExport = true;
        },
      );

      if (!didExport) {
        return;
      }

      const message = `Successfully exported ${projectName} changes to: ${exportPath}`;
      vscode.window.showInformationMessage(message);
      const openAfter = vscode.workspace
        .getConfiguration('exportStagedFiles')
        .get<boolean>('openFolderAfterExport', true);
      if (openAfter) {
        if (targetIsArchive) {
          // Reveal the archive in folder
          this.revealFile(exportPath);
        } else {
          this.openFolder(exportPath);
        }
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(
        `Failed to export changed files: ${error.message}`,
      );
    }
  }

  private openFolder(exportPath: string) {
    if (process.platform === 'win32') {
      exec(`explorer "${exportPath}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${exportPath}"`);
    } else {
      exec(`xdg-open "${exportPath}"`);
    }
  }

  private revealFile(filePath: string) {
    if (process.platform === 'win32') {
      exec(`explorer /select,"${filePath}"`);
    } else if (process.platform === 'darwin') {
      exec(`open -R "${filePath}"`);
    } else {
      exec(`xdg-open "${path.dirname(filePath)}"`);
    }
  }

  private applyTemplate(template: string, ctx: Record<string, string>) {
    const sanitized = template.replace(/[<>:"/\\|?*]/g, '-');
    return sanitized.replace(
      /\{(project|branch|hash|timestamp|user)\}/g,
      (_, key) => {
        return (ctx[key] || '').toString();
      },
    );
  }

  private makeTimestamp() {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return (
      d.getFullYear().toString() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      '-' +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds())
    );
  }

  private async sha256File(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve());
    });
    return hash.digest('hex');
  }

  private async copyDirectory(srcDir: string, destDir: string) {
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
    await fs.promises.mkdir(destDir, { recursive: true });
    for (const entry of entries) {
      const src = path.join(srcDir, entry.name);
      const dest = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        await this.copyDirectory(src, dest);
      } else if (entry.isFile()) {
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        await fs.promises.copyFile(src, dest);
      }
    }
  }

  private async createArchive(
    contentDir: string,
    outPath: string,
    format: 'zip' | 'tar.gz',
  ) {
    await new Promise<void>((resolve, reject) => {
      // Lazy require to avoid type resolution issues when package not yet installed
      const archiver: any = require('archiver');
      const output = fs.createWriteStream(outPath);
      const archive = archiver(
        format === 'zip' ? 'zip' : 'tar',
        format === 'zip'
          ? { zlib: { level: 9 } }
          : { gzip: true, gzipOptions: { level: 9 } },
      );

      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      // append the directory and include a top-level folder in the archive
      const topLevel = path.basename(contentDir);
      archive.directory(contentDir, topLevel);
      archive.finalize().catch(reject);
    });
  }

  private async safeGit<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch {
      return null;
    }
  }

  private async getBranchName(cwd: string): Promise<string> {
    return await this.execText('git rev-parse --abbrev-ref HEAD', cwd);
  }

  private async getShortHash(cwd: string): Promise<string> {
    return await this.execText('git rev-parse --short HEAD', cwd);
  }

  private async getUserName(cwd: string): Promise<string> {
    return await this.execText('git config user.name', cwd);
  }

  private async execText(cmd: string, cwd: string): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      exec(cmd, { cwd }, (err, stdout) => {
        if (err) {
          return reject(err);
        }
        resolve(stdout.trim());
      });
    });
  }
}
