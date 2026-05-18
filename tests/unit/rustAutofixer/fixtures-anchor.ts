// Fixtures for Anchor tier-1 visitors (attribute-only).
// Each pair: vulnerable + secure, framework: "anchor".

const ANCHOR_HEADER = `use anchor_lang::prelude::*;\n`;

// ---------- anchor-seeds-without-bump ----------
export const VULNERABLE_SEEDS_WITHOUT_BUMP = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, payer = admin, space = 8 + 32, seeds = [b"escrow"])]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const SECURE_SEEDS_WITH_BUMP = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, payer = admin, space = 8 + 32, seeds = [b"escrow"], bump)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

// ---------- anchor-init-without-space ----------
export const VULNERABLE_INIT_WITHOUT_SPACE = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, payer = admin)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const SECURE_INIT_WITH_SPACE = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, payer = admin, space = 8 + 32)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

// ---------- anchor-init-without-payer ----------
export const VULNERABLE_INIT_WITHOUT_PAYER = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, space = 8 + 32)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const SECURE_INIT_WITH_PAYER = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Init<'info> {
  #[account(init, payer = admin, space = 8 + 32)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

// ---------- anchor-realloc-incomplete ----------
export const VULNERABLE_REALLOC_INCOMPLETE = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Grow<'info> {
  #[account(mut, realloc = 8 + 64)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const SECURE_REALLOC_COMPLETE = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Grow<'info> {
  #[account(mut, realloc = 8 + 64, realloc::payer = admin, realloc::zero = true)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub admin: Signer<'info>,
  pub system_program: Program<'info, System>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

// ---------- anchor-account-not-interface (tier 2) ----------
export const VULNERABLE_ACCOUNT_NOT_INTERFACE = `${ANCHOR_HEADER}
use anchor_spl::token::{Mint, TokenAccount};
#[derive(Accounts)]
pub struct Use<'info> {
  pub mint: Account<'info, Mint>,
  pub token_account: Account<'info, TokenAccount>,
  pub admin: Signer<'info>,
}
`;

export const SECURE_ACCOUNT_INTERFACE = `${ANCHOR_HEADER}
use anchor_spl::token_interface::{Mint, TokenAccount};
#[derive(Accounts)]
pub struct Use<'info> {
  pub mint: InterfaceAccount<'info, Mint>,
  pub token_account: InterfaceAccount<'info, TokenAccount>,
  pub admin: Signer<'info>,
}
`;

// ---------- anchor-manual-signer-check (tier 2) ----------
export const VULNERABLE_MANUAL_SIGNER_CHECK = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  pub admin: AccountInfo<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(ctx: Context<Ctx>) -> Result<()> {
    if !ctx.accounts.admin.is_signer {
      return err!(ErrorCode::Unauthorized);
    }
    Ok(())
  }
}
#[error_code]
pub enum ErrorCode { Unauthorized }
`;

export const SECURE_TYPED_SIGNER = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(_ctx: Context<Ctx>) -> Result<()> {
    Ok(())
  }
}
`;

// ---------- anchor-manual-key-eq (tier 2) ----------
export const VULNERABLE_MANUAL_KEY_EQ = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  pub state: Account<'info, State>,
  pub authority: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(ctx: Context<Ctx>) -> Result<()> {
    require_keys_eq!(ctx.accounts.authority.key(), ctx.accounts.state.authority);
    Ok(())
  }
}
#[account]
pub struct State { pub authority: Pubkey }
`;

export const SECURE_HAS_ONE = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  #[account(has_one = authority)]
  pub state: Account<'info, State>,
  pub authority: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(_ctx: Context<Ctx>) -> Result<()> {
    Ok(())
  }
}
#[account]
pub struct State { pub authority: Pubkey }
`;

// ---------- anchor-emit-via-msg (tier 2) ----------
export const VULNERABLE_EMIT_VIA_MSG = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(ctx: Context<Ctx>, amount: u64) -> Result<()> {
    msg!("Deposit event: amount={}", amount);
    Ok(())
  }
}
`;

export const SECURE_EMIT = `${ANCHOR_HEADER}
#[event]
pub struct Deposit { pub amount: u64 }
#[derive(Accounts)]
pub struct Ctx<'info> {
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(_ctx: Context<Ctx>, amount: u64) -> Result<()> {
    emit!(Deposit { amount });
    Ok(())
  }
}
`;

// ---------- anchor-missing-mut (tier 3) ----------
export const VULNERABLE_MISSING_MUT = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  pub state: Account<'info, State>,
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(ctx: Context<Ctx>, new_value: u64) -> Result<()> {
    ctx.accounts.state.value = new_value;
    Ok(())
  }
}
#[account]
pub struct State { pub value: u64 }
`;

export const SECURE_MUT_CONSTRAINT = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  #[account(mut)]
  pub state: Account<'info, State>,
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(ctx: Context<Ctx>, new_value: u64) -> Result<()> {
    ctx.accounts.state.value = new_value;
    Ok(())
  }
}
#[account]
pub struct State { pub value: u64 }
`;

// ---------- anchor-cpi-context-unverified (tier 3) ----------
export const VULNERABLE_CPI_UNVERIFIED = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  pub token_program: AccountInfo<'info>,
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(ctx: Context<Ctx>) -> Result<()> {
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), Empty {});
    invoke_helper(cpi_ctx)?;
    Ok(())
  }
}
struct Empty;
fn invoke_helper<T>(_c: CpiContext<T>) -> Result<()> { Ok(()) }
`;

export const SECURE_CPI_TYPED_PROGRAM = `${ANCHOR_HEADER}
use anchor_spl::token::Token;
#[derive(Accounts)]
pub struct Ctx<'info> {
  pub token_program: Program<'info, Token>,
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn run(ctx: Context<Ctx>) -> Result<()> {
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), Empty {});
    invoke_helper(cpi_ctx)?;
    Ok(())
  }
}
struct Empty;
fn invoke_helper<T>(_c: CpiContext<T>) -> Result<()> { Ok(()) }
`;

// ---------- anchor-close-without-receiver (tier 3) ----------
export const VULNERABLE_CLOSE_MANUAL = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  #[account(mut)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub receiver: AccountInfo<'info>,
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn close_it(ctx: Context<Ctx>) -> Result<()> {
    let from = ctx.accounts.escrow.to_account_info();
    let dest = ctx.accounts.receiver.to_account_info();
    **dest.lamports.borrow_mut() = dest.lamports().checked_add(from.lamports()).unwrap();
    **ctx.accounts.escrow.to_account_info().lamports.borrow_mut() = 0;
    Ok(())
  }
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

export const SECURE_CLOSE_CONSTRAINT = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Ctx<'info> {
  #[account(mut, close = receiver)]
  pub escrow: Account<'info, Escrow>,
  #[account(mut)]
  pub receiver: AccountInfo<'info>,
  pub admin: Signer<'info>,
}
#[program]
pub mod my_program {
  use super::*;
  pub fn close_it(_ctx: Context<Ctx>) -> Result<()> { Ok(()) }
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;

// ---------- anchor-unchecked-account ----------
export const VULNERABLE_UNCHECKED_ACCOUNT = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Use<'info> {
  /// CHECK: docs missing, validation missing
  pub mystery: UncheckedAccount<'info>,
  pub admin: Signer<'info>,
}
`;

export const SECURE_TYPED_ACCOUNT = `${ANCHOR_HEADER}
#[derive(Accounts)]
pub struct Use<'info> {
  pub escrow: Account<'info, Escrow>,
  pub admin: Signer<'info>,
}
#[account]
pub struct Escrow { pub admin: Pubkey }
`;
