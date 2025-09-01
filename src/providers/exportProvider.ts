import * as vscode from 'vscode';

export class ExportProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    return [
      this.createItem('☁️ Export', 'exportStagedFiles.export'),
      this.createItem(
        '📂 Export Custom',
        'exportStagedFiles.exportWithCustomFolder',
      ),
    ];
  }

  private createItem(label: string, command: string): vscode.TreeItem {
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.command = { command, title: label };
    return item;
  }
}
