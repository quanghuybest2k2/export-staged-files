import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GitChanges {
  staged: string[];
  modified: string[];
  untracked: string[];
}

export class GitService {
  constructor(private cwd: string) {}

  async getChangedFiles(): Promise<GitChanges> {
    const [staged, modified, untracked] = await Promise.all([
      this.execList('git diff --cached --name-only'),
      this.execList('git diff --name-only'),
      this.execList('git ls-files --others --exclude-standard'),
    ]);
    return { staged, modified, untracked };
  }

  private async execList(cmd: string): Promise<string[]> {
    const { stdout } = await execAsync(cmd, { cwd: this.cwd });
    return stdout
      .trim()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}
