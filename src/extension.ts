import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext) {
  // Command để export với folder mặc định
  let exportCommand = vscode.commands.registerCommand(
    "exportStagedFiles.export",
    async () => {
      await exportStagedFiles();
    }
  );

  // Command để export với custom folder
  let exportCustomCommand = vscode.commands.registerCommand(
    "exportStagedFiles.exportWithCustomFolder",
    async () => {
      const folderName = await vscode.window.showInputBox({
        prompt: "Enter folder name for exported files",
        value: "exported-changes",
        validateInput: (value) => {
          if (!value || value.trim() === "") {
            return "Folder name cannot be empty";
          }
          // Kiểm tra tên folder hợp lệ
          if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
            return "Invalid folder name";
          }
          return null;
        },
      });

      if (folderName) {
        await exportStagedFiles(folderName.trim());
      }
    }
  );

  context.subscriptions.push(exportCommand, exportCustomCommand);
}

async function exportStagedFiles(customFolder?: string) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("No workspace folder found");
    return;
  }

  const config = vscode.workspace.getConfiguration("exportStagedFiles");
  const defaultFolder = config.get<string>("defaultFolder", "exported-changes");
  const openFolderAfterExport = config.get<boolean>(
    "openFolderAfterExport",
    true
  );

  const exportFolder = customFolder || defaultFolder;
  const workspacePath = workspaceFolder.uri.fsPath;
  const exportPath = path.join(workspacePath, exportFolder);

  try {
    // Hiển thị progress
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Exporting staged files...",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ increment: 10, message: "Getting staged files..." });

        // Lấy danh sách staged files
        const { stdout: stagedFiles } = await execAsync(
          "git diff --cached --name-only",
          {
            cwd: workspacePath,
          }
        );

        if (!stagedFiles.trim()) {
          vscode.window.showWarningMessage("No staged files found");
          return;
        }

        const files = stagedFiles
          .trim()
          .split("\n")
          .filter((file) => file.trim());
        progress.report({
          increment: 20,
          message: `Found ${files.length} staged files`,
        });

        // Tạo export folder
        if (fs.existsSync(exportPath)) {
          await fs.promises.rm(exportPath, { recursive: true, force: true });
        }
        await fs.promises.mkdir(exportPath, { recursive: true });

        progress.report({
          increment: 30,
          message: "Creating folder structure...",
        });

        // Copy từng file với cấu trúc thư mục
        const totalFiles = files.length;
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const sourcePath = path.join(workspacePath, file);
          const targetPath = path.join(exportPath, file);
          const targetDir = path.dirname(targetPath);

          // Tạo thư mục cha nếu chưa tồn tại
          await fs.promises.mkdir(targetDir, { recursive: true });

          // Copy file
          if (fs.existsSync(sourcePath)) {
            await fs.promises.copyFile(sourcePath, targetPath);
          }

          // Update progress
          const progressPercent = Math.floor(((i + 1) / totalFiles) * 40);
          progress.report({
            increment: 0,
            message: `Copying files... (${i + 1}/${totalFiles})`,
          });
        }

        progress.report({ increment: 100, message: "Export completed!" });
      }
    );

    // Thông báo thành công
    const message = `Successfully exported staged files to: ${exportFolder}`;
    const actions = ["Open Folder", "Open in Explorer"];

    const action = await vscode.window.showInformationMessage(
      message,
      ...actions
    );

    if (action === "Open Folder") {
      // Mở folder trong VS Code
      const uri = vscode.Uri.file(exportPath);
      await vscode.commands.executeCommand("vscode.openFolder", uri, {
        forceNewWindow: true,
      });
    } else if (action === "Open in Explorer") {
      // Mở trong file explorer
      if (process.platform === "win32") {
        exec(`explorer "${exportPath}"`);
      } else if (process.platform === "darwin") {
        exec(`open "${exportPath}"`);
      } else {
        exec(`xdg-open "${exportPath}"`);
      }
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(
      `Failed to export staged files: ${error.message}`
    );
  }
}

export function deactivate() {}
