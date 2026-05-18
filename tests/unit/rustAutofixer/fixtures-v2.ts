// Fixtures for the 17 v1.1 visitors. Each pair: vulnerable + secure.
// Wrapped in `use pinocchio::*` so the framework auto-detect picks Pinocchio.

const PINOCCHIO_USE = `use pinocchio::account_view::AccountView;
use pinocchio::program_error::ProgramError;
`;

// ----- unsafe-unwrap (Check 25) -----
export const VULNERABLE_UNSAFE_UNWRAP = `${PINOCCHIO_USE}
pub fn handle() -> Result<u64, ProgramError> {
  let amount: Option<u64> = compute();
  Ok(amount.unwrap())
}
fn compute() -> Option<u64> { Some(0) }
`;
export const SECURE_UNSAFE_UNWRAP = `${PINOCCHIO_USE}
pub fn handle() -> Result<u64, ProgramError> {
  let amount: Option<u64> = compute();
  amount.ok_or(ProgramError::InvalidArgument)
}
fn compute() -> Option<u64> { Some(0) }
`;

// ----- event-via-cpi (Check 21) -----
export const VULNERABLE_EVENT_VIA_CPI = `${PINOCCHIO_USE}
pub fn emit(amount: u64) {
  msg!("transfer amount: {}", amount);
}
`;
export const SECURE_EVENT_VIA_CPI = `${PINOCCHIO_USE}
pub fn emit(program_id: &[u8;32], event_authority: &AccountView, program: &AccountView, amount: u64) -> Result<(), ProgramError> {
  emit_event(program_id, event_authority, program, &amount.to_le_bytes())?;
  Ok(())
}
fn emit_event(_p: &[u8;32], _a: &AccountView, _b: &AccountView, _d: &[u8]) -> Result<(), ProgramError> { Ok(()) }
`;

// ----- unchecked-deserialization (Check 14) -----
export const VULNERABLE_UNCHECKED_DESER = `${PINOCCHIO_USE}
pub fn read(data: &[u8]) -> &Escrow {
  unsafe { &*(data.as_ptr() as *const Escrow) }
}
struct Escrow;
`;
export const SECURE_UNCHECKED_DESER = `${PINOCCHIO_USE}
unsafe fn from_bytes_unchecked(data: &[u8]) -> &Escrow {
  unsafe { &*(data.as_ptr() as *const Escrow) }
}
struct Escrow;
`;

// ----- data-size-validation (Check 12) -----
export const VULNERABLE_DATA_SIZE = `${PINOCCHIO_USE}
pub fn read(data: &[u8]) -> Result<Escrow, ProgramError> {
  let e = Escrow::from_bytes_unchecked(data);
  Ok(e)
}
struct Escrow;
impl Escrow { fn from_bytes_unchecked(_d: &[u8]) -> Self { Self } }
`;
export const SECURE_DATA_SIZE = `${PINOCCHIO_USE}
pub fn read(data: &[u8]) -> Result<Escrow, ProgramError> {
  require_len!(data, Escrow::LEN);
  let e = Escrow::from_bytes_unchecked(data);
  Ok(e)
}
struct Escrow;
impl Escrow { const LEN: usize = 32; fn from_bytes_unchecked(_d: &[u8]) -> Self { Self } }
`;

// ----- type-cosplay (Check 13) -----
export const VULNERABLE_TYPE_COSPLAY = `${PINOCCHIO_USE}
struct Escrow;
struct Config;
impl Discriminator for Escrow { const DISCRIMINATOR: u8 = 0; }
impl Discriminator for Config { const DISCRIMINATOR: u8 = 0; }
trait Discriminator { const DISCRIMINATOR: u8; }
`;
export const SECURE_TYPE_COSPLAY = `${PINOCCHIO_USE}
struct Escrow;
struct Config;
impl Discriminator for Escrow { const DISCRIMINATOR: u8 = 0; }
impl Discriminator for Config { const DISCRIMINATOR: u8 = 1; }
trait Discriminator { const DISCRIMINATOR: u8; }
`;

// ----- account-closure (Check 23) -----
export const VULNERABLE_ACCOUNT_CLOSURE = `${PINOCCHIO_USE}
pub fn close_account(account: &AccountView, recipient: &AccountView) -> Result<(), ProgramError> {
  recipient.set_lamports(recipient.lamports().checked_add(account.lamports()).ok_or(ProgramError::ArithmeticOverflow)?);
  account.set_lamports(0);
  Ok(())
}
`;
export const SECURE_ACCOUNT_CLOSURE = `${PINOCCHIO_USE}
pub fn close_account(account: &AccountView, recipient: &AccountView) -> Result<(), ProgramError> {
  recipient.set_lamports(recipient.lamports().checked_add(account.lamports()).ok_or(ProgramError::ArithmeticOverflow)?);
  account.set_lamports(0);
  account.close()?;
  Ok(())
}
`;

// ----- reinitialization (Check 15) -----
export const VULNERABLE_REINIT = `${PINOCCHIO_USE}
struct CreateAccount<'a> { from: &'a AccountView, to: &'a AccountView, lamports: u64, space: u64, owner: [u8;32] }
impl<'a> CreateAccount<'a> { fn invoke_signed(&self, _s: &[u8]) -> Result<(), ProgramError> { Ok(()) } }
pub fn create(payer: &AccountView, pda: &AccountView) -> Result<(), ProgramError> {
  CreateAccount { from: payer, to: pda, lamports: 1_000_000, space: 100, owner: [0u8;32] }.invoke_signed(&[])?;
  Ok(())
}
`;
export const SECURE_REINIT = `${PINOCCHIO_USE}
struct CreateAccount<'a> { from: &'a AccountView, to: &'a AccountView, lamports: u64, space: u64, owner: [u8;32] }
impl<'a> CreateAccount<'a> { fn invoke_signed(&self, _s: &[u8]) -> Result<(), ProgramError> { Ok(()) } }
pub fn create(payer: &AccountView, pda: &AccountView) -> Result<(), ProgramError> {
  if pda.lamports() > 0 { return Err(ProgramError::AccountAlreadyInitialized); }
  CreateAccount { from: payer, to: pda, lamports: 1_000_000, space: 100, owner: [0u8;32] }.invoke_signed(&[])?;
  Ok(())
}
`;

// ----- rent-exempt (Check 17) -----
export const VULNERABLE_RENT_EXEMPT = `${PINOCCHIO_USE}
struct CreateAccount<'a> { from: &'a AccountView, to: &'a AccountView, lamports: u64, space: u64, owner: [u8;32] }
impl<'a> CreateAccount<'a> { fn invoke(&self) -> Result<(), ProgramError> { Ok(()) } }
pub fn create(payer: &AccountView, pda: &AccountView) -> Result<(), ProgramError> {
  if pda.lamports() > 0 { return Err(ProgramError::AccountAlreadyInitialized); }
  CreateAccount { from: payer, to: pda, lamports: 1_000_000, space: 100, owner: [0u8;32] }.invoke()?;
  Ok(())
}
`;
export const SECURE_RENT_EXEMPT = `${PINOCCHIO_USE}
struct CreateAccount<'a> { from: &'a AccountView, to: &'a AccountView, lamports: u64, space: u64, owner: [u8;32] }
impl<'a> CreateAccount<'a> { fn invoke(&self) -> Result<(), ProgramError> { Ok(()) } }
pub fn create(payer: &AccountView, pda: &AccountView, required: u64) -> Result<(), ProgramError> {
  if pda.lamports() > 0 { return Err(ProgramError::AccountAlreadyInitialized); }
  CreateAccount { from: payer, to: pda, lamports: required, space: 100, owner: [0u8;32] }.invoke()?;
  Ok(())
}
`;

// ----- authority-escalation (Check 19) -----
export const VULNERABLE_AUTHORITY_ESC = `${PINOCCHIO_USE}
struct State { admin: [u8;32] }
pub fn rotate(state: &mut State, new_admin: [u8;32]) {
  state.admin = new_admin;
}
`;
export const SECURE_AUTHORITY_ESC = `${PINOCCHIO_USE}
struct State { admin: [u8;32] }
pub fn rotate(state: &mut State, current_signer: &AccountView, new_admin: [u8;32]) -> Result<(), ProgramError> {
  verify_signer(current_signer, false)?;
  if current_signer.key().ne(&state.admin) {
    return Err(ProgramError::MissingRequiredSignature);
  }
  state.admin = new_admin;
  Ok(())
}
fn verify_signer(_a: &AccountView, _b: bool) -> Result<(), ProgramError> { Ok(()) }
`;

export const VULNERABLE_AUTHORITY_ESC_UNRELATED_SIGNER = `${PINOCCHIO_USE}
struct State { admin: [u8;32] }
pub fn rotate(state: &mut State, payer: &AccountView, new_admin: [u8;32]) -> Result<(), ProgramError> {
  verify_signer(payer, false)?;
  state.admin = new_admin;
  Ok(())
}
fn verify_signer(_a: &AccountView, _b: bool) -> Result<(), ProgramError> { Ok(()) }
`;

export const VULNERABLE_AUTHORITY_ESC_PASSIVE_COMPARE = `${PINOCCHIO_USE}
struct State { admin: [u8;32] }
pub fn rotate(state: &mut State, current_signer: &AccountView, new_admin: [u8;32]) -> Result<(), ProgramError> {
  verify_signer(current_signer, false)?;
  if current_signer.key() == &state.admin {
    msg!("admin seen");
  }
  state.admin = new_admin;
  Ok(())
}
fn verify_signer(_a: &AccountView, _b: bool) -> Result<(), ProgramError> { Ok(()) }
`;

// ----- token-2022-extensions (Check 22) -----
export const VULNERABLE_TOKEN_2022 = `${PINOCCHIO_USE}
use pinocchio_token_2022::TOKEN_2022_PROGRAM_ID;
pub fn transfer_some(mint: &AccountView) -> Result<(), ProgramError> {
  // No safe-mint check!
  Ok(())
}
`;
export const SECURE_TOKEN_2022 = `${PINOCCHIO_USE}
use pinocchio_token_2022::TOKEN_2022_PROGRAM_ID;
pub fn transfer_some(mint: &AccountView) -> Result<(), ProgramError> {
  verify_safe_mint(mint)?;
  Ok(())
}
fn verify_safe_mint(_m: &AccountView) -> Result<(), ProgramError> { Ok(()) }
`;

// ----- instruction-data-bounds (Check 24) -----
export const VULNERABLE_INSTR_BOUNDS = `${PINOCCHIO_USE}
struct MyData { bump: u8 }
impl TryFrom<&[u8]> for MyData {
  type Error = ProgramError;
  fn try_from(data: &[u8]) -> Result<Self, Self::Error> {
    let bump = data[0];
    Ok(Self { bump })
  }
}
`;
export const SECURE_INSTR_BOUNDS = `${PINOCCHIO_USE}
struct MyData { bump: u8 }
impl MyData { const LEN: usize = 1; }
impl TryFrom<&[u8]> for MyData {
  type Error = ProgramError;
  fn try_from(data: &[u8]) -> Result<Self, Self::Error> {
    require_len!(data, MyData::LEN);
    let bump = data[0];
    Ok(Self { bump })
  }
}
`;

// ----- pda-seed-collision (Check 9) -----
export const VULNERABLE_SEED_COLLISION = `${PINOCCHIO_USE}
struct Escrow;
struct Config;
impl Pda for Escrow { const PREFIX: &'static [u8] = b"vault"; }
impl Pda for Config { const PREFIX: &'static [u8] = b"vault"; }
trait Pda { const PREFIX: &'static [u8]; }
`;
export const SECURE_SEED_COLLISION = `${PINOCCHIO_USE}
struct Escrow;
struct Config;
impl Pda for Escrow { const PREFIX: &'static [u8] = b"escrow"; }
impl Pda for Config { const PREFIX: &'static [u8] = b"config"; }
trait Pda { const PREFIX: &'static [u8]; }
`;

// ----- bump-canonicalization (Check 10) -----
export const VULNERABLE_BUMP_CANON = `use pinocchio::pubkey::find_program_address;
pub fn handle(account: &AccountView, seed: &[u8]) -> Result<(), ProgramError> {
  let (pda, bump) = find_program_address(&[seed], &crate::ID);
  if account.key() == &pda { /* but bump never compared */ }
  Ok(())
}
`;
export const SECURE_BUMP_CANON = `use pinocchio::pubkey::find_program_address;
pub fn handle(account: &AccountView, seed: &[u8], stored_bump: u8) -> Result<(), ProgramError> {
  let (pda, bump) = find_program_address(&[seed], &crate::ID);
  assert_eq!(bump, stored_bump);
  if account.key() == &pda { /* ok */ }
  Ok(())
}
`;

// ----- writable-mutation (Check 5) -----
export const VULNERABLE_WRITABLE_MUTATION = `${PINOCCHIO_USE}
struct WAccounts<'a> { pub config: &'a AccountView }
impl<'a> WAccounts<'a> {
  pub fn try_from(accounts: &'a [AccountView]) -> Result<Self, ProgramError> {
    let [config] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    verify_writable(config, true)?;
    Ok(Self { config })
  }
}
pub fn process(a: WAccounts) -> Result<(), ProgramError> {
  let _ = a.config.lamports();
  Ok(())
}
fn verify_writable(_a: &AccountView, _f: bool) -> Result<(), ProgramError> { Ok(()) }
`;
export const SECURE_WRITABLE_MUTATION = `${PINOCCHIO_USE}
struct WAccounts<'a> { pub config: &'a AccountView }
impl<'a> WAccounts<'a> {
  pub fn try_from(accounts: &'a [AccountView]) -> Result<Self, ProgramError> {
    let [config] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    verify_writable(config, true)?;
    Ok(Self { config })
  }
}
pub fn process(a: WAccounts) -> Result<(), ProgramError> {
  a.config.set_lamports(123);
  Ok(())
}
fn verify_writable(_a: &AccountView, _f: bool) -> Result<(), ProgramError> { Ok(()) }
`;

// ----- account-relationship (Check 26) -----
export const VULNERABLE_ACCOUNT_REL = `${PINOCCHIO_USE}
struct TransferChecked<'a> { from: &'a AccountView, to: &'a AccountView, mint: &'a AccountView, amount: u64 }
impl<'a> TransferChecked<'a> { fn invoke(&self) -> Result<(), ProgramError> { Ok(()) } }
pub fn handle(from: &AccountView, to: &AccountView, mint: &AccountView) -> Result<(), ProgramError> {
  TransferChecked { from, to, mint, amount: 100 }.invoke()?;
  Ok(())
}
`;
export const SECURE_ACCOUNT_REL = `${PINOCCHIO_USE}
struct TransferChecked<'a> { from: &'a AccountView, to: &'a AccountView, mint: &'a AccountView, amount: u64 }
impl<'a> TransferChecked<'a> { fn invoke(&self) -> Result<(), ProgramError> { Ok(()) } }
pub fn handle(from: &AccountView, to: &AccountView, mint: &AccountView, wallet: &AccountView, token_program: &AccountView) -> Result<(), ProgramError> {
  validate_associated_token_account(from, wallet, mint, token_program)?;
  TransferChecked { from, to, mint, amount: 100 }.invoke()?;
  Ok(())
}
fn validate_associated_token_account(_a: &AccountView, _b: &AccountView, _c: &AccountView, _d: &AccountView) -> Result<(), ProgramError> { Ok(()) }
`;

// ----- account-borrow (Check 27) -----
export const VULNERABLE_ACCOUNT_BORROW = `${PINOCCHIO_USE}
pub fn handle(a: &AccountView) -> Result<(), ProgramError> {
  let _d1 = a.try_borrow_mut()?;
  let _d2 = a.try_borrow_mut()?;
  Ok(())
}
`;
export const SECURE_ACCOUNT_BORROW = `${PINOCCHIO_USE}
pub fn handle(a: &AccountView) -> Result<(), ProgramError> {
  let d1 = a.try_borrow_mut()?;
  drop(d1);
  let _d2 = a.try_borrow_mut()?;
  Ok(())
}
`;

// ----- unsafe-unwrap noise suppression: fixed-length slice + try_into is infallible -----
export const SECURE_UNWRAP_FIXED_SLICE_LITERAL = `${PINOCCHIO_USE}
pub fn parse(data: &[u8]) -> u32 {
  u32::from_le_bytes(data[0..4].try_into().unwrap())
}
`;
export const SECURE_UNWRAP_FIXED_SLICE_OFFSET = `${PINOCCHIO_USE}
pub fn parse(data: &[u8], offset: usize) -> u32 {
  u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}
`;
export const SECURE_UNWRAP_TO_LE_BYTES = `${PINOCCHIO_USE}
pub fn pack(value: u64) -> [u8; 8] {
  value.to_le_bytes().try_into().unwrap()
}
`;
// Still risky: from_utf8 on attacker-controlled bytes
export const VULNERABLE_UNWRAP_FROM_UTF8 = `${PINOCCHIO_USE}
pub fn read_name(args_name: &[u8]) -> &str {
  core::str::from_utf8(args_name).unwrap()
}
`;

// ----- existing-lamports (Check 16) -----
export const VULNERABLE_EXISTING_LAMPORTS = `${PINOCCHIO_USE}
pub fn create(pda: &AccountView, payer: &AccountView) -> Result<(), ProgramError> {
  if pda.lamports() > 0 {
    // Branch exists but does nothing - skip account creation
    return Ok(());
  }
  Ok(())
}
`;
export const SECURE_EXISTING_LAMPORTS = `${PINOCCHIO_USE}
struct Allocate<'a> { account: &'a AccountView, space: u64 }
struct Assign<'a> { account: &'a AccountView, owner: [u8;32] }
impl<'a> Allocate<'a> { fn invoke_signed(&self, _s: &[u8]) -> Result<(), ProgramError> { Ok(()) } }
impl<'a> Assign<'a> { fn invoke_signed(&self, _s: &[u8]) -> Result<(), ProgramError> { Ok(()) } }
pub fn create(pda: &AccountView, payer: &AccountView) -> Result<(), ProgramError> {
  if pda.lamports() > 0 {
    Allocate { account: pda, space: 100 }.invoke_signed(&[])?;
    Assign { account: pda, owner: [0u8;32] }.invoke_signed(&[])?;
  }
  Ok(())
}
`;

export const VULNERABLE_REINIT_UNRELATED_LAMPORTS = `${PINOCCHIO_USE}
struct CreateAccount<'a> { from: &'a AccountView, to: &'a AccountView, lamports: u64, space: u64, owner: [u8;32] }
impl<'a> CreateAccount<'a> { fn invoke_signed(&self, _s: &[u8]) -> Result<(), ProgramError> { Ok(()) } }
pub fn create(payer: &AccountView, pda: &AccountView) -> Result<(), ProgramError> {
  if payer.lamports() < 1 { return Err(ProgramError::InsufficientFunds); }
  CreateAccount { from: payer, to: pda, lamports: 1_000_000, space: 100, owner: [0u8;32] }.invoke_signed(&[])?;
  Ok(())
}
`;

export const SECURE_EXISTING_LAMPORTS_REJECTS = `${PINOCCHIO_USE}
pub fn create(pda: &AccountView) -> Result<(), ProgramError> {
  if pda.lamports() > 0 {
    return Err(ProgramError::AccountAlreadyInitialized);
  }
  Ok(())
}
`;

export const SECURE_EXISTING_LAMPORTS_ZERO_BRANCH = `${PINOCCHIO_USE}
pub fn create(pda: &AccountView) -> Result<(), ProgramError> {
  if pda.lamports() == 0 {
    msg!("fresh account");
  }
  Ok(())
}
`;
