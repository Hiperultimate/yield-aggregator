use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_interface::{Mint, TokenAccount, TokenInterface}};

use crate::{AllocationConfig, AllocationMode, Vault, error::ErrorCode};

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub admin : Signer<'info>,

    #[account(
        mint::token_program=token_program
    )]
    pub usdc_mint : InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer=admin,
        associated_token::mint=usdc_mint,
        associated_token::authority=vault,
        associated_token::token_program=token_program
    )]
    pub vault_usdc_ata : InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        space = 8 + AllocationConfig::INIT_SPACE,
        seeds=[b"allocation_config", admin.key().as_ref() ],
        bump
    )]
    pub vault_allocation_config : Account<'info, AllocationConfig>,

    #[account(
        init,
        payer = admin,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", admin.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,   // Global vault
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>

}

impl<'info> InitializeVault<'info> {
    pub fn initialize_vault(&mut self, vault_bump: u8, allocation_config_bump: u8, jup_allocation : u16, kamino_allocation: u16) -> Result<()>{
        require!(jup_allocation + kamino_allocation == 10_000, ErrorCode::InvalidAllocation);
        let current_time = Clock::get().unwrap().unix_timestamp;

        // vault states
        self.vault.authority = self.admin.key();
        self.vault.usdc_mint = self.usdc_mint.key();
        self.vault.vault_usdc_ata = self.vault_usdc_ata.key();
        self.vault.allocation_config = self.vault_allocation_config.key();
        self.vault.total_deposits = 0;
        self.vault.jup_lend_balance = 0;
        self.vault.kamino_balance = 0;
        self.vault.is_active = true;
        self.vault.bump = vault_bump;

        // vault_allocation_config states
        self.vault_allocation_config.vault = self.vault.key();
        self.vault_allocation_config.mode = AllocationMode::Static;
        self.vault_allocation_config.jup_allocation = jup_allocation;
        self.vault_allocation_config.kamino_allocation = kamino_allocation;
        self.vault_allocation_config.last_jup_yield = 0;
        self.vault_allocation_config.last_kamino_yield = 0;
        self.vault_allocation_config.last_rebalanced_at = current_time;
        self.vault_allocation_config.authority = self.vault.key();
        self.vault_allocation_config.bump = allocation_config_bump;
        Ok(())
    }
}

pub fn handler(ctx: Context<InitializeVault> , jup_allocation: u16 ,kamino_allocation: u16)  -> Result<()> {
    ctx.accounts.initialize_vault(ctx.bumps.vault, ctx.bumps.vault_allocation_config, jup_allocation, kamino_allocation)?;

    Ok(())
}
