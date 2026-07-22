export interface SourceAdmissionFacts {
  readonly changedPaths: readonly string[];
  readonly isConflicted: boolean;
}

export type DeclaredPathKind = "regular_file" | "absent" | "symlink" | "directory" | "other" | "outside_root" | "invalid_parent";

export interface DeclaredPathFacts {
  readonly path: string;
  readonly kind: DeclaredPathKind;
}

/** Read-only boundary used before a direct task may own any external resource. */
export interface DirectTaskAdmissionRuntime {
  inspectSource(root: string): Promise<SourceAdmissionFacts>;
  inspectDeclaredPath(root: string, path: string): Promise<DeclaredPathFacts>;
  findRetainedRunIds(stateDirectory: string): Promise<readonly string[]>;
}
