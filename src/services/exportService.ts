import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
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

    try {
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          path.join(require('os').homedir(), 'Desktop', projectName),
        ),
        filters: { Folder: ['*'] },
        saveLabel: 'Select Export Location',
      });

      if (!saveUri) {
        return; // cancelled
      }

      const exportPath = saveUri.fsPath;
      const git = new GitService(workspacePath);

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

          // Prepare export folder
          if (fs.existsSync(exportPath)) {
            await fs.promises.rm(exportPath, { recursive: true, force: true });
          }
          await fs.promises.mkdir(exportPath, { recursive: true });

          progress.report({
            increment: 20,
            message: 'Creating folder structure...',
          });

          // Write export info
          const exportInfo = {
            projectName,
            exportDate: new Date().toISOString(),
            totalFiles: files.length,
            stagedFiles: changes.staged.length,
            modifiedFiles: changes.modified.length,
            untrackedFiles: changes.untracked.length,
            files,
          };
          await fs.promises.writeFile(
            path.join(exportPath, 'export-info.json'),
            JSON.stringify(exportInfo, null, 2),
            'utf8',
          );

          // Copy files
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const sourcePath = path.join(workspacePath, file);
            const targetPath = path.join(exportPath, file);
            const targetDir = path.dirname(targetPath);

            try {
              await fs.promises.mkdir(targetDir, { recursive: true });
              if (fs.existsSync(sourcePath)) {
                const stats = await fs.promises.stat(sourcePath);
                if (stats.isFile()) {
                  await fs.promises.copyFile(sourcePath, targetPath);
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

          progress.report({ increment: 100, message: 'Export completed!' });
        },
      );

      const message = `Successfully exported ${projectName} changes to: ${exportPath}`;
      vscode.window.showInformationMessage(message);
      this.openFolder(exportPath);
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
}
