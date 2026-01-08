export type ArchiveFilter = "all" | "active" | "archived";

export type SortOrder = "asc" | "desc";

export type CodexPaths = {
  codexDir: string;
  sessionsDir: string;
  archivedDir: string;
};

export type SessionRecord = {
  id?: string;
  filePath: string;
  fileName: string;
  archived: boolean;
  cwd?: string;
  title?: string;
  tags: string[];
  timestamp?: string;
  dateLabel?: string;
  displayName: string;
  sortKey: number;
  originator?: string;
  cliVersion?: string;
  source?: string;
  modelProvider?: string;
  git?: {
    repositoryUrl?: string;
    branch?: string;
    commitHash?: string;
  };
};
