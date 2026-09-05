export function assertProjectScope(projectId: string, recordProjectId: string): boolean {
  return Boolean(projectId) && projectId === recordProjectId;
}

export function scopedOrUndefined<T extends { project_id: string }>(
  projectId: string,
  record: T | undefined,
): T | undefined {
  if (!record || record.project_id !== projectId) {
    return undefined;
  }
  return record;
}
