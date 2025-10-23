use anchor_lang::prelude::*;


#[derive(InitSpace, AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum AllocationMode {
    Static,
    Dynamic,
}

// AllocationConfig for Vault only
#[account]
#[derive(InitSpace)]
pub struct AllocationConfig {
    /// Reference back to the vault this config belongs to - added security using constraints
    pub vault: Pubkey,

    /// Admin can change allocation mode
    pub mode: AllocationMode,

    /// Target allocation percentage 
    pub jup_allocation: u16,    // e.g , 6000 = 60% -> For precision 61.34% = 6134
    pub kamino_allocation: u16, // e.g , 4000 = 40%

    pub last_jup_yield: i64,     // last snapshot of JupLend yield
    pub last_kamino_yield: i64,  // last snapshot of Kamino yield

    pub last_rebalanced_at: i64,

    /// Authority that can modify allocation
    pub authority: Pubkey,

    pub bump: u8,
}

