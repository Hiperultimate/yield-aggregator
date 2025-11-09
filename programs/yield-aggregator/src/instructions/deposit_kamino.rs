pub use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::{invoke_signed}};
use anchor_spl::{associated_token::AssociatedToken, token::Token, token_interface::{Mint, TokenAccount}};
use crate::Vault;

#[derive(Accounts)]
pub struct DepositKamino<'info> {

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", admin.key().as_ref()],
        // bump = main_vault.bump,
        bump
    )]
    pub main_vault: Account<'info, Vault>,

    #[account(
        mut,
        constraint = main_vault.vault_usdc_ata.key() == main_vault_usdc_ata.key(),
        associated_token::mint=usdc_mint,
        associated_token::authority=main_vault,
        associated_token::token_program=token_program
    )]
    pub main_vault_usdc_ata : InterfaceAccount<'info, TokenAccount>,

    #[account(
        constraint = main_vault.usdc_mint.key() == usdc_mint.key(), 
        mint::token_program=token_program
    )]
    pub usdc_mint : InterfaceAccount<'info, Mint>,   // USDC Mint

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

    /// CHECK: User's (or PDA's) token account holding USDC to deposit
    /// In our case its usdc_vault
    // #[account(mut)]
    // pub user_source_liquidity: UncheckedAccount<'info>,

    /// CHECK: User's (or PDA's) token account receiving collateral tokens
    /// Kamino named this variable as user_destination_collateral
    #[account(
        mut,
        associated_token::mint=reserve_collateral_mint,
        associated_token::authority=main_vault,
        associated_token::token_program=token_program,
    )]
    pub main_vault_kamino_token_ata_collateral: InterfaceAccount<'info, TokenAccount>,

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

pub fn get_deposit_reserve_liquidity_discriminator()-> Vec<u8> {
    // discriminator = sha256("global:deposit_reserve_liquidity")[0..8]
    vec![169, 201, 30, 126, 6, 205, 102, 68]
}

impl<'info> DepositKamino<'info> {
    pub fn kamino_deposit(&mut self, deposited_amount : u64) -> Result<()>{
        let mut instruction_data = get_deposit_reserve_liquidity_discriminator();
        instruction_data.extend_from_slice(&deposited_amount.to_le_bytes());

        let accounts = vec![
            AccountMeta::new_readonly(self.main_vault.key(), true),    // signer
            AccountMeta::new(self.reserve.key(), false),
            AccountMeta::new_readonly(self.lending_market.key(), false),
            AccountMeta::new_readonly(self.lending_market_authority.key(), false),
            AccountMeta::new_readonly(self.usdc_mint.key(), false),
            AccountMeta::new(self.reserve_liquidity_supply.key(), false),
            AccountMeta::new(self.reserve_collateral_mint.key(), false),
            AccountMeta::new(self.main_vault_usdc_ata.key(), false),
            AccountMeta::new(self.main_vault_kamino_token_ata_collateral.key(), false),
            AccountMeta::new_readonly(self.collateral_token_program.key(), false),
            AccountMeta::new_readonly(self.liquidity_token_program.key(), false),
            AccountMeta::new_readonly(self.instruction_sysvar_account.key(), false),
        ];
        
        let ix = Instruction {
            program_id: self.klend_program.key(),
            accounts,
            data : instruction_data,
        };

        let account_infos = [
            self.main_vault.to_account_info(),
            self.reserve.to_account_info(),
            self.lending_market.to_account_info(),
            self.lending_market_authority.to_account_info(),
            self.usdc_mint.to_account_info(),
            self.reserve_liquidity_supply.to_account_info(),
            self.reserve_collateral_mint.to_account_info(),
            self.main_vault_usdc_ata.to_account_info(),
            self.main_vault_kamino_token_ata_collateral.to_account_info(),
            self.collateral_token_program.to_account_info(),
            self.liquidity_token_program.to_account_info(),
            self.instruction_sysvar_account.to_account_info(),
        ];

        let admin_key = self.admin.key();
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", admin_key.as_ref(),&[self.main_vault.bump]]];

        invoke_signed(&ix, &account_infos, signer_seeds)?;

        Ok(())
    }
}

pub fn handler(ctx : Context<DepositKamino>, amount : u64) -> Result<()>{
    ctx.accounts.kamino_deposit(amount)?;
    Ok(())
}