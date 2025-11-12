use anchor_lang::prelude::*;
use crate::Vault;

#[derive(Accounts)]
pub struct SyncVaultState<'info> {
    #[account(
        mut,
        seeds = [b"vault", admin.key().as_ref()],
        bump = vault.bump,
        constraint = vault.authority == admin.key()
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub admin: Signer<'info>,
}

pub fn handler(
    ctx: Context<SyncVaultState>,
    new_jup_allocation : u16,
    new_kamino_allocation : u16,
    new_jup_lend_balance : u64,
    new_kamino_balance : u64,
    new_acc_per_share: u64,
    new_total_underlying: u64,
    new_jup_value: u64,
    new_kamino_value: u64,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.jup_allocation = new_jup_allocation;
    vault.kamino_allocation = new_kamino_allocation;
    vault.jup_lend_balance = new_jup_lend_balance;
    vault.kamino_balance = new_kamino_balance;
    vault.acc_per_share = new_acc_per_share;
    vault.total_underlying = new_total_underlying;
    vault.last_jup_value = new_jup_value;
    vault.last_kamino_value = new_kamino_value;
    vault.last_update_ts = Clock::get()?.unix_timestamp;
    
    Ok(())
}