import * as vscode from 'vscode';
import { registerCommands } from './features/commands';
import { ExportProvider } from './providers/exportProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new ExportProvider();
  vscode.window.registerTreeDataProvider('exportStagedFilesView', provider);

  registerCommands(context);
}

export function deactivate() {}
