pub use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke};
use anchor_spl::{associated_token::AssociatedToken, token_interface::{TokenAccount, TokenInterface}};

#[derive(Accounts)]
pub struct DepositKamino<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: Kamino reserve account
    #[account(mut)]
    pub reserve: UncheckedAccount<'info>,

    /// CHECK: Lending market that the reserve belongs to
    pub lending_market: UncheckedAccount<'info>,

    /// CHECK: PDA authority for the lending market
    pub lending_market_authority: UncheckedAccount<'info>,

    /// CHECK: Mint of the liquidity token (e.g., USDC Mint)
    pub reserve_liquidity_mint: UncheckedAccount<'info>,

    /// CHECK: Token account that stores liquidity supplied to reserve
    #[account(mut)]
    pub reserve_liquidity_supply: UncheckedAccount<'info>,

    /// CHECK: Mint of the collateral token
    #[account(mut)]
    pub reserve_collateral_mint: UncheckedAccount<'info>,

    /// CHECK: User's (or PDA's) token account holding USDC to deposit
    #[account(mut)]
    pub user_source_liquidity: UncheckedAccount<'info>,

    /// CHECK: User's (or PDA's) token account receiving collateral tokens
    // #[account(mut)]
    // pub user_destination_collateral: UncheckedAccount<'info>,

    #[account(
        init,
        payer=owner,
        associated_token::mint=reserve_collateral_mint,
        associated_token::authority=owner,
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

    // Users collateral mint account init
    // #[account(
    //     init,
    //     payer=owner,
    //     associated_token::mint=reserve_collateral_mint,
    //     associated_token::authority=owner,
    //     // associated_token::token_program=token_program,
    // )]
    // pub owner_collateral_mint_ata : InterfaceAccount<'info, TokenAccount>,// FIX THIS


    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program : Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn get_deposit_reserve_liquidity_discriminator()-> Vec<u8> {
    // discriminator = sha256("global:deposit_reserve_liquidity")[0..8]
    vec![169, 201, 30, 126, 6, 205, 102, 68]
}

pub fn handler(ctx : Context<DepositKamino>, amount : u64) -> Result<()>{
    // Kamino Lend program ID

    let mut instruction_data = get_deposit_reserve_liquidity_discriminator();
    instruction_data.extend_from_slice(&amount.to_le_bytes());

    let accounts = vec![
        AccountMeta::new_readonly(ctx.accounts.owner.key(), true),    // signer
        AccountMeta::new(ctx.accounts.reserve.key(), false),
        AccountMeta::new_readonly(ctx.accounts.lending_market.key(), false),
        AccountMeta::new_readonly(ctx.accounts.lending_market_authority.key(), false),
        AccountMeta::new_readonly(ctx.accounts.reserve_liquidity_mint.key(), false),
        AccountMeta::new(ctx.accounts.reserve_liquidity_supply.key(), false),
        AccountMeta::new(ctx.accounts.reserve_collateral_mint.key(), false),
        AccountMeta::new(ctx.accounts.user_source_liquidity.key(), false),
        AccountMeta::new(ctx.accounts.user_destination_collateral.key(), false),
        AccountMeta::new_readonly(ctx.accounts.collateral_token_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.liquidity_token_program.key(), false),
        AccountMeta::new_readonly(ctx.accounts.instruction_sysvar_account.key(), false),
    ];
    
    let ix = Instruction {
        program_id: ctx.accounts.klend_program.key(),
        accounts,
        data : instruction_data,
    };

    let account_infos = [
        ctx.accounts.owner.to_account_info(),
        ctx.accounts.reserve.to_account_info(),
        ctx.accounts.lending_market.to_account_info(),
        ctx.accounts.lending_market_authority.to_account_info(),
        ctx.accounts.reserve_liquidity_mint.to_account_info(),
        ctx.accounts.reserve_liquidity_supply.to_account_info(),
        ctx.accounts.reserve_collateral_mint.to_account_info(),
        ctx.accounts.user_source_liquidity.to_account_info(),
        ctx.accounts.user_destination_collateral.to_account_info(),
        ctx.accounts.collateral_token_program.to_account_info(),
        ctx.accounts.liquidity_token_program.to_account_info(),
        ctx.accounts.instruction_sysvar_account.to_account_info(),
    ];

    invoke(
        &ix,
        &account_infos,
    )?;

    Ok(())
}