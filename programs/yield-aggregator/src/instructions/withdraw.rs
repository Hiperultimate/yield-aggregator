use anchor_lang::{prelude::*, solana_program::{instruction::Instruction, program::invoke_signed}};
use anchor_spl::{associated_token::AssociatedToken, token::Token, token_interface::{Mint, TokenAccount, TokenInterface}};

use crate::{Vault, error::ErrorCode, Lending as JupLending, Reserve};
use crate::jup_cpi;
use crate::jup_accounts;
use crate::JupLendingProgram;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: admin details required to derive vault
    #[account(
        constraint = main_vault.authority.key() == admin.key()
    )]
    pub admin : AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"vault", admin.key().as_ref()],
        bump
    )]
    pub main_vault: Box<Account<'info, Vault>>,

    #[account(
        mut,
        constraint = main_vault.vault_usdc_ata.key() == main_vault_usdc_ata.key(),
        associated_token::mint=usdc_mint,
        associated_token::authority=main_vault,
        associated_token::token_program=token_program
    )]
    pub main_vault_usdc_ata : Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint=usdc_mint,
        associated_token::authority=admin,
        associated_token::token_program=token_program
    )]
    pub admin_usdc_ata : Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint=usdc_mint,
        associated_token::authority=user,
        associated_token::token_program=token_program
    )]
    pub user_usdc_ata : Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        constraint = main_vault.usdc_mint.key() == usdc_mint.key(),
        mint::token_program=token_program
    )]
    pub usdc_mint : Box<InterfaceAccount<'info, Mint>>,

    /// Jup related accounts
    #[account(
        mut,
        constraint = main_vault.vault_usdc_ata.key() == main_vault_usdc_ata.key(), // We add this later
        associated_token::mint=f_token_mint,
        associated_token::authority=main_vault,
        associated_token::token_program=token_program
    )]
    pub main_vault_f_token_ata : Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        mint::token_program=token_program
    )]
    pub f_token_mint : Box<InterfaceAccount<'info, Mint>>,

    /// lending_admin (read-only)
    /// CHECK: Validated by lending program
    pub lending_admin: AccountInfo<'info>,

    /// lending (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub lending: AccountInfo<'info>,
    
    /// supply_token_reserves_liquidity (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub supply_token_reserves_liquidity: AccountInfo<'info>,
    
    /// lending_supply_position_on_liquidity (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub lending_supply_position_on_liquidity: AccountInfo<'info>,
    
    /// rate_model (read-only)
    /// CHECK: Validated by lending program
    pub rate_model: AccountInfo<'info>,
    
    /// vault (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    /// CHECK: Validated by lending program
    pub claim_account: AccountInfo<'info>,

    /// liquidity (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub liquidity: AccountInfo<'info>,

    /// liquidity_program (mutable)
    #[account(mut)]
    /// CHECK: Validated by lending program
    pub liquidity_program: AccountInfo<'info>,

    /// rewards_rate_model (read-only)
    /// /// CHECK: Validated by lending program
    pub rewards_rate_model: AccountInfo<'info>,

    /// CHECK: Validated by lending program
    pub lending_program: Program<'info, JupLendingProgram>,

    // Kamino Accounts
    /// CHECK: Kamino reserve account
    #[account(mut)]
    pub reserve: UncheckedAccount<'info>,

    /// CHECK: Lending market that the reserve belongs to
    pub lending_market: UncheckedAccount<'info>,

    /// CHECK: PDA authority for the lending market
    pub lending_market_authority: UncheckedAccount<'info>,

    /// CHECK: Token account that stores liquidity supplied to reserve
    #[account(mut)]
    pub reserve_liquidity_supply: UncheckedAccount<'info>,

    /// CHECK: Mint of the collateral token
    #[account(mut)]
    pub reserve_collateral_mint: UncheckedAccount<'info>,

    /// CHECK: User's (or PDA's) token account receiving collateral tokens
    /// Kamino named this variable as user_destination_collateral
    #[account(
        mut,
        associated_token::mint=reserve_collateral_mint,
        associated_token::authority=main_vault,
        associated_token::token_program=token_program,
    )]
    pub main_vault_kamino_token_ata_collateral: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Token program for the collateral mint (usually TOKEN_PROGRAM_ID)
    pub collateral_token_program: UncheckedAccount<'info>,

    /// CHECK: Token program for the liquidity mint (usually TOKEN_PROGRAM_ID)
    pub liquidity_token_program: UncheckedAccount<'info>,

    /// CHECK: Instructions sysvar
    pub instruction_sysvar_account: UncheckedAccount<'info>,

    /// CHECK : klend program account
    pub klend_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn get_redeem_reserve_collateral_discriminator() -> Vec<u8> {
    // discriminator = sha256("global:redeem_reserve_collateral")[0..8]
    vec![234, 117, 181, 125, 185, 142, 220, 29]
}

impl<'info> Withdraw<'info> {
    pub fn jup_withdraw(&mut self, f_token_amount: u64) -> Result<()> {
        // withdraw from jup
        let jup_accounts = jup_accounts::Redeem{
            signer: self.main_vault.to_account_info(),
            owner_token_account: self.main_vault_f_token_ata.to_account_info(),
            recipient_token_account: self.main_vault_usdc_ata.to_account_info(),
            f_token_mint: self.f_token_mint.to_account_info(),
            lending: self.lending.to_account_info(),
            lending_admin: self.lending_admin.to_account_info(),
            lending_supply_position_on_liquidity: self.lending_supply_position_on_liquidity.to_account_info(),
            liquidity: self.liquidity.to_account_info(),
            liquidity_program: self.liquidity_program.to_account_info(),
            mint: self.usdc_mint.to_account_info(),
            rate_model: self.rate_model.to_account_info(),
            rewards_rate_model: self.rewards_rate_model.to_account_info(),
            supply_token_reserves_liquidity: self.supply_token_reserves_liquidity.to_account_info(),
            vault: self.vault.to_account_info(),
            claim_account: self.claim_account.to_account_info(),
            associated_token_program: self.associated_token_program.to_account_info(),
            token_program: self.token_program.to_account_info(),
            system_program: self.system_program.to_account_info(),
        };

        let admin_key = self.main_vault.authority;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", admin_key.as_ref(), &[self.main_vault.bump]]];

        let jup_cpi_program = self.lending_program.to_account_info();
        let jup_cpi_context = CpiContext::new_with_signer(jup_cpi_program, jup_accounts, signer_seeds);
        match jup_cpi::redeem(jup_cpi_context, f_token_amount) {
            Ok(_) => Ok(()),
            Err(_) => Err(ErrorCode::CpiToLendingProgramFailed.into())
        }
    }

    pub fn kamino_withdraw(&mut self, collateral_amount: u64) -> Result<()> {
        let mut instruction_data = get_redeem_reserve_collateral_discriminator();
        instruction_data.extend_from_slice(&collateral_amount.to_le_bytes());

        let accounts = vec![
            AccountMeta::new_readonly(self.main_vault.key(), true), // owner/signer
            AccountMeta::new_readonly(self.lending_market.key(), false),
            AccountMeta::new(self.reserve.key(), false),
            AccountMeta::new_readonly(self.lending_market_authority.key(), false),
            AccountMeta::new(self.usdc_mint.key(), false), // reserveLiquidityMint (writable)
            AccountMeta::new(self.reserve_collateral_mint.key(), false),
            AccountMeta::new(self.reserve_liquidity_supply.key(), false),
            AccountMeta::new(self.main_vault_kamino_token_ata_collateral.key(), false), // userSourceCollateral
            AccountMeta::new(self.main_vault_usdc_ata.key(), false), // userDestinationLiquidity
            AccountMeta::new_readonly(self.collateral_token_program.key(), false),
            AccountMeta::new_readonly(self.liquidity_token_program.key(), false),
            AccountMeta::new_readonly(self.instruction_sysvar_account.key(), false),
        ];

        let ix = Instruction {
            program_id: self.klend_program.key(),
            accounts,
            data: instruction_data,
        };

        let account_infos = [
            self.main_vault.to_account_info(),
            self.lending_market.to_account_info(),
            self.reserve.to_account_info(),
            self.lending_market_authority.to_account_info(),
            self.usdc_mint.to_account_info(),
            self.reserve_collateral_mint.to_account_info(),
            self.reserve_liquidity_supply.to_account_info(),
            self.main_vault_kamino_token_ata_collateral.to_account_info(),
            self.main_vault_usdc_ata.to_account_info(),
            self.collateral_token_program.to_account_info(),
            self.liquidity_token_program.to_account_info(),
            self.instruction_sysvar_account.to_account_info(),
        ];

        let admin_key = self.main_vault.authority;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", admin_key.as_ref(), &[self.main_vault.bump]]];

        invoke_signed(&ix, &account_infos, signer_seeds)?;

        Ok(())
    }

    pub fn withdraw(&mut self, withdraw_amount: u64) -> Result<()> {
        // Get current allocation percentages 
        let jup_allocation = self.main_vault.jup_allocation as u64;
        let kamino_allocation = self.main_vault.kamino_allocation as u64;
        let scale = 10_000u64;

        // Compute how much USDC to withdraw from each platform 
        let jup_withdraw_usdc = (withdraw_amount as u128 * jup_allocation as u128 / scale as u128) as u64;
        let kamino_withdraw_usdc = (withdraw_amount as u128 * kamino_allocation as u128 / scale as u128) as u64;

        // Get Jup + Kamino exchange rates (to compute token withdrawals)
        let lending_data = JupLending::try_deserialize(&mut &self.lending.data.borrow()[..])?;
        let token_exchange_price = lending_data.token_exchange_price;
        let jup_exchange_rate = (token_exchange_price as u128) / 10u128.pow(6);

        let reserve_data = Reserve::try_deserialize(&mut &self.reserve.data.borrow()[..])?;
        let total_liquidity = reserve_data.liquidity.available_amount;
        let total_collateral_supply = reserve_data.collateral.mint_total_supply;
        let kamino_exchange_rate = (total_liquidity as u128 * 10u128.pow(6)) / total_collateral_supply as u128;

        // Convert desired USDC withdrawal to platform token amounts
        let jup_token_amount = ((jup_withdraw_usdc as u128 * 10u128.pow(6)) / jup_exchange_rate as u128) as u64;
        let kamino_token_amount = ((kamino_withdraw_usdc as u128 * 10u128.pow(6)) / kamino_exchange_rate) as u64;

        // Perform actual withdrawals from Jup + Kamino
        self.jup_withdraw(jup_token_amount)?;
        self.kamino_withdraw(kamino_token_amount)?;

        // Compute yield (acc_per_share logic)
        const SCALER: u128 = 1_000_000_000_000; // 1e12 precision (or same as used in deposit/rebalance)
        let total_underlying_before = self.main_vault.total_underlying as u128;
        let total_underlying_after = total_underlying_before.saturating_sub(withdraw_amount as u128);

        // Yield from this withdrawal (if any)
        let yield_generated = total_underlying_before.saturating_sub(total_underlying_after);

        // Increment acc_per_share (scaled)
        let acc_increment = if yield_generated > 0 && self.main_vault.total_shares > 0 {
            (yield_generated * SCALER) / self.main_vault.total_shares as u128
        } else {
            0
        };
        let new_acc_per_share = (self.main_vault.acc_per_share as u128).saturating_add(acc_increment);
        self.main_vault.acc_per_share = new_acc_per_share as u64; // store scaled down

        // Transfer final USDC to user
        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: self.main_vault_usdc_ata.to_account_info(),
                    to: self.user_usdc_ata.to_account_info(),
                    authority: self.main_vault.to_account_info(),
                },
                &[&[b"vault", self.main_vault.authority.as_ref(), &[self.main_vault.bump]]],
            ),
            withdraw_amount,
        )?;

        // Update vault states
        self.main_vault.jup_lend_balance = self
            .main_vault
            .jup_lend_balance
            .saturating_sub(jup_withdraw_usdc);
        self.main_vault.kamino_balance = self
            .main_vault
            .kamino_balance
            .saturating_sub(kamino_withdraw_usdc);
        self.main_vault.total_underlying = total_underlying_after as u64;

        // Update snapshots for next rebalance baseline
        self.main_vault.last_jup_value = self.main_vault.last_jup_value.saturating_sub(jup_withdraw_usdc);
        self.main_vault.last_kamino_value = self.main_vault.last_kamino_value.saturating_sub(kamino_withdraw_usdc);
        self.main_vault.last_update_ts = Clock::get()?.unix_timestamp;

        Ok(())
    }

}

pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    ctx.accounts.withdraw(amount)?;
    Ok(())
}