#[derive(Debug, Clone, Copy)]
pub struct Migration {
    pub version: u32,
    pub name: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "init",
        sql: include_str!("../../sql/0001_init.sql"),
    },
];

pub fn schema_versions() -> Vec<u32> {
    MIGRATIONS.iter().map(|m| m.version).collect()
}
