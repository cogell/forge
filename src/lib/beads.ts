/**
 * Integration with the `bd` CLI for beads issue tracking.
 */

export interface EpicInfo {
  epicId: string;
  title: string;
  totalTasks: number;
  closedTasks: number;
  openTasks: number;
  inProgressTasks: number;
  allClosed: boolean;
}

export interface ReadyTask {
  id: string;
  title: string;
  priority: number;
  labels: string[];
}

/**
 * Query beads for an epic matching the feature name.
 * Returns null if no epic found or bd is not available.
 */
export async function queryBeadsEpic(feature: string): Promise<EpicInfo | null> {
  try {
    const result = await exec(`bd search "${feature}" --type epic --json`);
    if (!result.stdout.trim()) return null;

    const epics = JSON.parse(result.stdout);
    if (!Array.isArray(epics) || epics.length === 0) return null;

    // Pick the most relevant epic
    const epic = epics[0];

    // Get children stats
    const children = await exec(`bd list --parent ${epic.id} --json`);
    const tasks = children.stdout.trim() ? JSON.parse(children.stdout) : [];

    const closedTasks = tasks.filter((t: any) => t.status === "closed").length;
    const inProgressTasks = tasks.filter((t: any) => t.status === "in_progress").length;
    const openTasks = tasks.filter((t: any) => t.status === "open").length;

    return {
      epicId: epic.id,
      title: epic.title,
      totalTasks: tasks.length,
      closedTasks,
      openTasks,
      inProgressTasks,
      allClosed: tasks.length > 0 && closedTasks === tasks.length,
    };
  } catch {
    return null;
  }
}

/**
 * Get ready (unblocked) tasks from beads.
 */
export async function getReadyTasks(): Promise<ReadyTask[]> {
  try {
    const result = await exec("bd ready --json");
    if (!result.stdout.trim()) return [];
    return JSON.parse(result.stdout);
  } catch {
    return [];
  }
}

/**
 * Check if bd CLI is available.
 */
export async function isBdAvailable(): Promise<boolean> {
  try {
    await exec("bd --version");
    return true;
  } catch {
    return false;
  }
}

async function exec(cmd: string): Promise<{ stdout: string; stderr: string }> {
  const proc = Bun.spawn(["sh", "-c", cmd], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Command failed: ${cmd}\n${stderr}`);
  }

  return { stdout, stderr };
}
