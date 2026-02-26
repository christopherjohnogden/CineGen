#[derive(Debug, Clone, Copy)]
pub struct SnapshotPolicy {
    pub every_n_commits: u32,
}

impl Default for SnapshotPolicy {
    fn default() -> Self {
        Self { every_n_commits: 50 }
    }
}

impl SnapshotPolicy {
    pub fn should_snapshot(
        &self,
        commit_count_since_snapshot: u32,
        structural_merge: bool,
        export_triggered: bool,
    ) -> bool {
        export_triggered
            || structural_merge
            || commit_count_since_snapshot >= self.every_n_commits
    }
}
