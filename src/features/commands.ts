import * as vscode from 'vscode';
import * as path from 'path';
import { ExportService } from '../services/exportService';

export function registerCommands(context: vscode.ExtensionContext) {
  const exportService = new ExportService();

  const exportCommand = vscode.commands.registerCommand(
    'exportStagedFiles.export',
    async () => {
      await exportService.exportChangedFiles();
    },
  );

  const exportCustomCommand = vscode.commands.registerCommand(
    'exportStagedFiles.exportWithCustomFolder',
    async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
      }

      const defaultProjectName = path.basename(workspaceFolder.uri.fsPath);

      const folderName = await vscode.window.showInputBox({
        prompt: 'Enter folder name for exported files',
        value: defaultProjectName,
        validateInput: (value) => {
          if (!value || value.trim() === '') {
            return 'Folder name cannot be empty';
          }
          if (!/^[^<>:\"/\\|?*]+$/.test(value)) {
            return 'Invalid folder name (contains invalid characters)';
          }
          return null;
        },
      });

      if (folderName) {
        await exportService.exportChangedFiles(folderName.trim());
      }
    },
  );

  context.subscriptions.push(exportCommand, exportCustomCommand);
}
