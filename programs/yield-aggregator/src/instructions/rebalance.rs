use anchor_lang::{prelude::*, solana_program::{instruction::Instruction, program::invoke_signed}};
use anchor_spl::{associated_token::AssociatedToken, token::Token, token_interface::{Mint, TokenAccount, TokenInterface}};

use crate::error::ErrorCode;
use crate::{Vault, jup_cpi};
use crate::jup_accounts;
use crate::JupLendingProgram;


#[derive(Accounts)]
pub struct Rebalance<'info> {
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


    /// Jup related accounts
    #[account(
        mut,
        // constraint = main_vault.vault_usdc_ata.key() == main_vault_usdc_ata.key(), // We add this later
        associated_token::mint=f_token_mint,
        associated_token::authority=main_vault,
        associated_token::token_program=token_program
    )]
    pub main_vault_f_token_ata : Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        mint::token_program=token_program
    )]
    pub f_token_mint : InterfaceAccount<'info, Mint>,

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
    
    /// depositor_token_account (mutable)
    // #[account(mut)]
    /// CHECK: Validated by lending program
    // pub depositor_token_account: AccountInfo<'info>,

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

    /// CHECK: User's (or PDA's) token account holding USDC to deposit
    /// In our case its usdc_vault
    // #[account(mut)]
    // pub user_source_liquidity: UncheckedAccount<'info>,

    /// CHECK: User's (or PDA's) token account receiving collateral tokens
    #[account(
        mut,
        associated_token::mint=reserve_collateral_mint,
        associated_token::authority=main_vault,
        associated_token::token_program=token_program,
    )]
    pub user_destination_collateral: InterfaceAccount<'info, TokenAccount>,

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

impl<'info> Rebalance<'info> {
    pub fn jup_deposit(&mut self, deposited_amount : u64) -> Result<()> {
        // transfer to jup
        let jup_accounts = jup_accounts::Deposit{
            signer: self.main_vault.to_account_info() ,
            depositor_token_account : self.main_vault_usdc_ata.to_account_info(),
            recipient_token_account: self.main_vault_f_token_ata.to_account_info(),

            associated_token_program : self.associated_token_program.to_account_info(),
            f_token_mint: self.f_token_mint.to_account_info(),
            lending: self.lending.to_account_info(),
            lending_admin: self.lending_admin.to_account_info() ,
            lending_supply_position_on_liquidity: self.lending_supply_position_on_liquidity.to_account_info() ,
            liquidity: self.liquidity.to_account_info() , 
            liquidity_program: self.liquidity_program.to_account_info() ,
            mint: self.usdc_mint.to_account_info() , 
            rate_model: self.rate_model.to_account_info() ,
            rewards_rate_model: self.rewards_rate_model.to_account_info() ,
            supply_token_reserves_liquidity: self.supply_token_reserves_liquidity.to_account_info() ,
            system_program: self.system_program.to_account_info() ,
            token_program: self.token_program.to_account_info() ,
            vault: self.vault.to_account_info() , 
        };

        let admin_key = self.admin.key();
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", admin_key.as_ref(),&[self.main_vault.bump]]];

        let jup_cpi_program = self.lending_program.to_account_info();
        let jup_cpi_context = CpiContext::new_with_signer(jup_cpi_program, jup_accounts, signer_seeds);
        match jup_cpi::deposit(jup_cpi_context, deposited_amount){
            Ok(_) => Ok(()),
            Err(_) => Err(ErrorCode::CpiToLendingProgramFailed.into())
        }
    }

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
            AccountMeta::new(self.user_destination_collateral.key(), false),
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
            self.user_destination_collateral.to_account_info(),
            self.collateral_token_program.to_account_info(),
            self.liquidity_token_program.to_account_info(),
            self.instruction_sysvar_account.to_account_info(),
        ];

        let admin_key = self.admin.key();
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", admin_key.as_ref(),&[self.main_vault.bump]]];

        invoke_signed(&ix, &account_infos, signer_seeds)?;

        Ok(())
    }


    pub fn rebalance(&mut self) -> Result<()> {
        // Rebalance logic here
        msg!("Rebalancing vault allocations");

        // lets hardcode deposit 50 USDC to each lending platforms, to check if they are working or not
        self.jup_deposit(50000000)?;
        msg!("Deposited jup");
        self.kamino_deposit(50000000)?;
        msg!("Deposited kamino");
        Ok(())
    }
}

pub fn handler(ctx: Context<Rebalance>) -> Result<()> {
    ctx.accounts.rebalance()?;
    Ok(())
}