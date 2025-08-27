import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext) {
  // Command để export với folder mặc định (chọn nơi lưu)
  let exportCommand = vscode.commands.registerCommand(
    "exportStagedFiles.export",
    async () => {
      await exportChangedFiles();
    }
  );

  // Command để export với custom folder name (chọn nơi lưu)
  let exportCustomCommand = vscode.commands.registerCommand(
    "exportStagedFiles.exportWithCustomFolder",
    async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder found");
        return;
      }

      const defaultProjectName = path.basename(workspaceFolder.uri.fsPath);

      const folderName = await vscode.window.showInputBox({
        prompt: "Enter folder name for exported files",
        value: defaultProjectName,
        validateInput: (value) => {
          if (!value || value.trim() === "") {
            return "Folder name cannot be empty";
          }
          // Kiểm tra tên folder hợp lệ cho Windows
          if (!/^[^<>:"/\\|?*]+$/.test(value)) {
            return "Invalid folder name (contains invalid characters)";
          }
          return null;
        },
      });

      if (folderName) {
        await exportChangedFiles(folderName.trim());
      }
    }
  );

  context.subscriptions.push(exportCommand, exportCustomCommand);
}

async function exportChangedFiles(customFolderName?: string) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("No workspace folder found");
    return;
  }

  const workspacePath = workspaceFolder.uri.fsPath;
  const projectName = customFolderName || path.basename(workspacePath);

  try {
    // Cho người dùng chọn nơi lưu
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        path.join(require("os").homedir(), "Desktop", projectName)
      ),
      filters: {
        Folder: ["*"],
      },
      saveLabel: "Select Export Location",
    });

    if (!saveUri) {
      return; // User cancelled
    }

    const exportPath = saveUri.fsPath;

    // Hiển thị progress
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Exporting changed files...",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ increment: 5, message: "Getting changed files..." });

        // Lấy staged changes
        const { stdout: stagedFiles } = await execAsync(
          "git diff --cached --name-only",
          { cwd: workspacePath }
        );

        // Lấy unstaged changes (modified files)
        const { stdout: modifiedFiles } = await execAsync(
          "git diff --name-only",
          { cwd: workspacePath }
        );

        // Lấy untracked files
        const { stdout: untrackedFiles } = await execAsync(
          "git ls-files --others --exclude-standard",
          { cwd: workspacePath }
        );

        // Gộp tất cả files và loại bỏ duplicate
        const allChangedFiles = new Set([
          ...stagedFiles
            .trim()
            .split("\n")
            .filter((f) => f.trim()),
          ...modifiedFiles
            .trim()
            .split("\n")
            .filter((f) => f.trim()),
          ...untrackedFiles
            .trim()
            .split("\n")
            .filter((f) => f.trim()),
        ]);

        const files = Array.from(allChangedFiles).filter((file) => file.trim());

        if (files.length === 0) {
          vscode.window.showWarningMessage("No changed files found");
          return;
        }

        progress.report({
          increment: 15,
          message: `Found ${files.length} changed files`,
        });

        // Tạo export folder
        if (fs.existsSync(exportPath)) {
          await fs.promises.rm(exportPath, { recursive: true, force: true });
        }
        await fs.promises.mkdir(exportPath, { recursive: true });

        progress.report({
          increment: 20,
          message: "Creating folder structure...",
        });

        // Tạo file thông tin về export
        const exportInfo = {
          projectName: projectName,
          exportDate: new Date().toISOString(),
          totalFiles: files.length,
          stagedFiles: stagedFiles
            .trim()
            .split("\n")
            .filter((f) => f.trim()).length,
          modifiedFiles: modifiedFiles
            .trim()
            .split("\n")
            .filter((f) => f.trim()).length,
          untrackedFiles: untrackedFiles
            .trim()
            .split("\n")
            .filter((f) => f.trim()).length,
          files: files,
        };

        await fs.promises.writeFile(
          path.join(exportPath, "export-info.json"),
          JSON.stringify(exportInfo, null, 2),
          "utf8"
        );

        // Copy từng file với cấu trúc thư mục
        const totalFiles = files.length;
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const sourcePath = path.join(workspacePath, file);
          const targetPath = path.join(exportPath, file);
          const targetDir = path.dirname(targetPath);

          try {
            // Tạo thư mục cha nếu chưa tồn tại
            await fs.promises.mkdir(targetDir, { recursive: true });

            // Copy file nếu tồn tại
            if (fs.existsSync(sourcePath)) {
              const stats = await fs.promises.stat(sourcePath);
              if (stats.isFile()) {
                await fs.promises.copyFile(sourcePath, targetPath);
              }
            }
          } catch (fileError) {
            console.warn(`Failed to copy file ${file}:`, fileError);
          }

          // Update progress
          const progressPercent = Math.floor(((i + 1) / totalFiles) * 55);
          progress.report({
            increment: 0,
            message: `Copying files... (${i + 1}/${totalFiles})`,
          });
        }

        progress.report({ increment: 100, message: "Export completed!" });
      }
    );

    // Thông báo thành công và mở Windows Explorer
    const message = `Successfully exported ${projectName} changes to: ${exportPath}`;

    vscode.window.showInformationMessage(message);

    // Mở Windows Explorer tại thư mục đã export
    if (process.platform === "win32") {
      exec(`explorer "${exportPath}"`);
    } else if (process.platform === "darwin") {
      exec(`open "${exportPath}"`);
    } else {
      exec(`xdg-open "${exportPath}"`);
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(
      `Failed to export changed files: ${error.message}`
    );
  }
}

export function deactivate() {}
