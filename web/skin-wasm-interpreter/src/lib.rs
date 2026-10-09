use wasmi::{
    Caller, Config, Engine, EnforcedLimits, Linker, Memory, MemoryType, Module, Store,
    StoreLimits, StoreLimitsBuilder,
};

const SOURCE_LIMIT: usize = 256 * 1024;
const STATUS_LIMIT: usize = 512;
const UI_INPUT_LIMIT: usize = 64 * 1024;
const UI_OUTPUT_LIMIT: usize = 16 * 1024;
const MEMORY_LIMIT_BYTES: usize = 64 * 64 * 1024;
const STATUS_READ_LIMIT: u32 = 10;
const FUEL_LIMIT: u64 = 10_000_000;

const ERROR_NONE: u32 = 0;
const ERROR_INPUT: u32 = 1;
const ERROR_MODULE: u32 = 2;
const ERROR_EXPORT: u32 = 4;
const ERROR_EXECUTION: u32 = 5;
const ERROR_HOST_MEMORY: u32 = 6;
const ERROR_MEMORY_LINK: u32 = 7;
const ERROR_STATUS_LINK: u32 = 8;
const ERROR_INSTANTIATION: u32 = 9;
const ERROR_IMPORT: u32 = 10;
const ERROR_PERMISSION: u32 = 11;
const ERROR_UI_OUTPUT: u32 = 12;
const ERROR_UI_INPUT: u32 = 13;

static mut LAST_ERROR_CODE: u32 = ERROR_NONE;
static mut LAST_STATUS_READ_COUNT: u32 = 0;
static mut LAST_UI_INPUT_READ_COUNT: u32 = 0;
static mut LAST_GUEST_MEMORY_BYTES: u32 = 0;
static mut LAST_UI_OUTPUT: [u8; UI_OUTPUT_LIMIT] = [0; UI_OUTPUT_LIMIT];
static mut LAST_UI_OUTPUT_LENGTH: u32 = 0;
static mut LAST_DIAGNOSTIC: [u8; 256] = [0; 256];
static mut LAST_DIAGNOSTIC_LENGTH: u32 = 0;

struct HostState {
    limits: StoreLimits,
    status: Vec<u8>,
    status_read_count: u32,
    ui_input: Vec<u8>,
    ui_input_read_count: u32,
    ui_input_invalid: bool,
    ui_output: Vec<u8>,
    ui_output_emitted: bool,
    ui_output_invalid: bool,
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(size: u32) -> u32 {
    if size == 0 || size as usize > SOURCE_LIMIT + STATUS_LIMIT + UI_INPUT_LIMIT {
        return 0;
    }
    let allocation = Vec::<u8>::with_capacity(size as usize);
    let pointer = allocation.as_ptr() as usize as u32;
    core::mem::forget(allocation);
    pointer
}

/// Runs one untrusted module inside Wasmi, whose entire allocator is bounded by
/// the fixed maximum memory of this outer Wasm artifact.
///
/// The web worker validates the byte ranges and permission grant before calling
/// this ABI. Every invocation gets a new Store, module, memory, and linker.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn run(
    module_pointer: u32,
    module_length: u32,
    status_pointer: u32,
    status_length: u32,
    ui_input_pointer: u32,
    ui_input_length: u32,
    status_permission_granted: u32,
    memory_maximum_pages: u32,
    fuel: u64,
) -> i64 {
    clear_diagnostic();
    clear_ui_output();
    set_report(ERROR_NONE, 0, 0, 0);
    let interpreter_memory_bytes = core::arch::wasm32::memory_size(0) as usize * 64 * 1024;
    if module_pointer == 0
        || module_length == 0
        || module_length as usize > SOURCE_LIMIT
        || status_length as usize > STATUS_LIMIT
        || (status_length != 0 && status_pointer == 0)
        || (status_length != 0 && status_permission_granted != 1)
        || ui_input_length == 0
        || ui_input_length as usize > UI_INPUT_LIMIT
        || ui_input_pointer == 0
        || !valid_range(module_pointer, module_length, interpreter_memory_bytes)
        || (status_length > 0 && !valid_range(status_pointer, status_length, interpreter_memory_bytes))
        || !valid_range(ui_input_pointer, ui_input_length, interpreter_memory_bytes)
        || !(1..=64).contains(&memory_maximum_pages)
        || fuel == 0
        || fuel > FUEL_LIMIT
    {
        set_report(ERROR_INPUT, 0, 0, 0);
        return 0;
    }

    let module_bytes = core::slice::from_raw_parts(module_pointer as usize as *const u8, module_length as usize);
    let status = if status_length == 0 {
        Vec::new()
    } else {
        core::slice::from_raw_parts(status_pointer as usize as *const u8, status_length as usize).to_vec()
    };
    let ui_input = core::slice::from_raw_parts(ui_input_pointer as usize as *const u8, ui_input_length as usize).to_vec();

    match execute(module_bytes, status, ui_input, status_permission_granted == 1, memory_maximum_pages, fuel) {
        Ok((result, status_reads, ui_input_reads, guest_memory_bytes, ui_output)) => {
            set_ui_output(&ui_output);
            set_report(ERROR_NONE, status_reads, ui_input_reads, guest_memory_bytes);
            result as i64
        }
        Err((error, status_reads, ui_input_reads, guest_memory_bytes)) => {
            set_report(error, status_reads, ui_input_reads, guest_memory_bytes);
            0
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn last_error_code() -> u32 {
    unsafe { LAST_ERROR_CODE }
}

#[unsafe(no_mangle)]
pub extern "C" fn last_status_read_count() -> u32 {
    unsafe { LAST_STATUS_READ_COUNT }
}

#[unsafe(no_mangle)]
pub extern "C" fn last_ui_input_read_count() -> u32 {
    unsafe { LAST_UI_INPUT_READ_COUNT }
}

#[unsafe(no_mangle)]
pub extern "C" fn last_guest_memory_bytes() -> u32 {
    unsafe { LAST_GUEST_MEMORY_BYTES }
}

#[unsafe(no_mangle)]
pub extern "C" fn last_ui_output_pointer() -> u32 {
    core::ptr::addr_of!(LAST_UI_OUTPUT) as usize as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn last_ui_output_length() -> u32 {
    unsafe { LAST_UI_OUTPUT_LENGTH }
}

#[unsafe(no_mangle)]
pub extern "C" fn last_diagnostic_pointer() -> u32 {
    core::ptr::addr_of!(LAST_DIAGNOSTIC) as usize as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn last_diagnostic_length() -> u32 {
    unsafe { LAST_DIAGNOSTIC_LENGTH }
}

fn clear_diagnostic() {
    unsafe { LAST_DIAGNOSTIC_LENGTH = 0; }
}

fn set_diagnostic(message: &str) {
    let bytes = message.as_bytes();
    let length = bytes.len().min(255);
    unsafe {
        let destination = core::ptr::addr_of_mut!(LAST_DIAGNOSTIC).cast::<u8>();
        core::ptr::copy_nonoverlapping(bytes.as_ptr(), destination, length);
        LAST_DIAGNOSTIC_LENGTH = length as u32;
    }
}

fn set_report(error: u32, status_reads: u32, ui_input_reads: u32, guest_memory_bytes: u32) {
    // Each interpreter instance runs in a dedicated Worker and accepts one job.
    unsafe {
        LAST_ERROR_CODE = error;
        LAST_STATUS_READ_COUNT = status_reads;
        LAST_UI_INPUT_READ_COUNT = ui_input_reads;
        LAST_GUEST_MEMORY_BYTES = guest_memory_bytes;
    }
}

fn clear_ui_output() {
    unsafe { LAST_UI_OUTPUT_LENGTH = 0; }
}

fn set_ui_output(output: &[u8]) {
    let length = output.len().min(UI_OUTPUT_LIMIT);
    unsafe {
        let destination = core::ptr::addr_of_mut!(LAST_UI_OUTPUT).cast::<u8>();
        core::ptr::copy_nonoverlapping(output.as_ptr(), destination, length);
        LAST_UI_OUTPUT_LENGTH = length as u32;
    }
}

fn valid_range(pointer: u32, length: u32, memory_bytes: usize) -> bool {
    let start = pointer as usize;
    let length = length as usize;
    pointer != 0 && start <= memory_bytes && length <= memory_bytes.saturating_sub(start)
}

fn execute(
    module_bytes: &[u8],
    status: Vec<u8>,
    ui_input: Vec<u8>,
    status_permission_granted: bool,
    memory_maximum_pages: u32,
    fuel: u64,
) -> Result<(i32, u32, u32, u32, Vec<u8>), (u32, u32, u32, u32)> {
    let mut config = Config::default();
    config
        .consume_fuel(true)
        .allow_start_fn(false)
        .wasm_reference_types(false)
        .wasm_multi_memory(false)
        .wasm_bulk_memory(true)
        .set_max_recursion_depth(128)
        .set_max_stack_height(64 * 1024)
        .set_max_cached_stacks(0)
        .enforced_limits(EnforcedLimits::strict());
    let engine = Engine::new(&config);
    let module = Module::new(&engine, &mut &module_bytes[..])
        .map_err(|_| (ERROR_MODULE, 0, 0, 0))?;
    let mut saw_memory = false;
    let mut saw_status = false;
    let mut saw_ui_output = false;
    let mut saw_ui_input = false;
    for import in module.imports() {
        match (import.module(), import.name(), import.ty()) {
            ("env", "memory", wasmi::ExternType::Memory(memory_type))
                if !saw_memory
                    && memory_type.minimum() <= 1
                    && memory_type.maximum().unwrap_or(64) == memory_maximum_pages as u64
                    && memory_type.maximum().unwrap_or(64) <= 64 =>
            {
                saw_memory = true;
            }
            ("env", "session_status_read", wasmi::ExternType::Func(_))
                if !saw_status && status_permission_granted =>
            {
                saw_status = true;
            }
            ("env", "session_status_read", wasmi::ExternType::Func(_)) => {
                return Err((ERROR_PERMISSION, 0, 0, 0));
            }
            ("env", "ui_emit_json", wasmi::ExternType::Func(_)) if !saw_ui_output => {
                saw_ui_output = true;
            }
            ("env", "ui_input_read", wasmi::ExternType::Func(_)) if !saw_ui_input => {
                saw_ui_input = true;
            }
            _ => return Err((ERROR_IMPORT, 0, 0, 0)),
        }
    }
    if !saw_memory {
        return Err((ERROR_IMPORT, 0, 0, 0));
    }
    let mut exports = module.exports();
    let Some(entry) = exports.next() else {
        return Err((ERROR_EXPORT, 0, 0, 0));
    };
    if entry.name() != "run"
        || !matches!(entry.ty(), wasmi::ExternType::Func(_))
        || exports.next().is_some()
    {
        return Err((ERROR_EXPORT, 0, 0, 0));
    }

    let limits = StoreLimitsBuilder::new()
        .memory_size(MEMORY_LIMIT_BYTES)
        .table_elements(0)
        .instances(1)
        // Wasmi counts the host-created import and the instantiated module's
        // view of that import independently inside one Store.
        .memories(2)
        .tables(0)
        .trap_on_grow_failure(true)
        .build();
    let mut store = Store::new(&engine, HostState {
        limits,
        status,
        status_read_count: 0,
        ui_input,
        ui_input_read_count: 0,
        ui_input_invalid: false,
        ui_output: Vec::new(),
        ui_output_emitted: false,
        ui_output_invalid: false,
    });
    store.limiter(|state| &mut state.limits);
    store.set_fuel(fuel).map_err(|_| (ERROR_EXECUTION, 0, 0, 0))?;

    let memory_type = MemoryType::new(1, Some(memory_maximum_pages));
    let memory = Memory::new(&mut store, memory_type)
        .map_err(|_| (ERROR_HOST_MEMORY, 0, 0, 0))?;
    let mut linker = Linker::<HostState>::new(&engine);
    linker
        .define("env", "memory", memory)
        .map_err(|_| (ERROR_MEMORY_LINK, 0, 0, 0))?;

    if status_permission_granted {
        let status_memory = memory;
        linker
            .func_wrap(
                "env",
                "session_status_read",
                move |mut caller: Caller<'_, HostState>, pointer: i32, capacity: i32| -> i32 {
                    if pointer < 0 || capacity < 0 {
                        return -1;
                    }
                    let offset = pointer as usize;
                    let capacity = capacity as usize;
                    let (status_size, reads, memory_size) = {
                        let state = caller.data();
                        (state.status.len(), state.status_read_count, status_memory.data(&caller).len())
                    };
                    if status_size == 0
                        || reads >= STATUS_READ_LIMIT
                        || capacity < status_size
                        || offset > memory_size.saturating_sub(capacity)
                    {
                        return -1;
                    }
                    let status = caller.data().status.clone();
                    if status_memory.write(&mut caller, offset, &status).is_err() {
                        return -1;
                    }
                    caller.data_mut().status_read_count += 1;
                    status_size as i32
                },
            )
            .map_err(|_| (ERROR_STATUS_LINK, 0, 0, 0))?;
    }

    let output_memory = memory;
    linker
        .func_wrap(
            "env",
            "ui_emit_json",
            move |mut caller: Caller<'_, HostState>, pointer: i32, length: i32| -> i32 {
                if pointer < 0 || length <= 0 || length as usize > UI_OUTPUT_LIMIT {
                    caller.data_mut().ui_output_invalid = true;
                    return -1;
                }
                let offset = pointer as usize;
                let length = length as usize;
                let memory_bytes = output_memory.data(&caller);
                if offset > memory_bytes.len() || length > memory_bytes.len() - offset {
                    caller.data_mut().ui_output_invalid = true;
                    return -1;
                }
                let output = memory_bytes[offset..offset + length].to_vec();
                if core::str::from_utf8(&output).is_err() || caller.data().ui_output_emitted {
                    caller.data_mut().ui_output_invalid = true;
                    return -1;
                }
                let state = caller.data_mut();
                state.ui_output = output;
                state.ui_output_emitted = true;
                length as i32
            },
        )
        .map_err(|_| (ERROR_IMPORT, 0, 0, 0))?;

    let input_memory = memory;
    linker
        .func_wrap(
            "env",
            "ui_input_read",
            move |mut caller: Caller<'_, HostState>, pointer: i32, capacity: i32| -> i32 {
                if pointer < 0 || capacity < 0 {
                    caller.data_mut().ui_input_invalid = true;
                    return -1;
                }
                let offset = pointer as usize;
                let capacity = capacity as usize;
                let (input_size, reads, memory_size) = {
                    let state = caller.data();
                    (state.ui_input.len(), state.ui_input_read_count, input_memory.data(&caller).len())
                };
                if input_size == 0
                    || input_size > UI_INPUT_LIMIT
                    || reads >= 1
                    || capacity < input_size
                    || offset > memory_size.saturating_sub(capacity)
                {
                    caller.data_mut().ui_input_invalid = true;
                    return -1;
                }
                let input = caller.data().ui_input.clone();
                if input_memory.write(&mut caller, offset, &input).is_err() {
                    caller.data_mut().ui_input_invalid = true;
                    return -1;
                }
                caller.data_mut().ui_input_read_count += 1;
                input_size as i32
            },
        )
        .map_err(|_| (ERROR_IMPORT, 0, 0, 0))?;

    let instance = match linker.instantiate_and_start(&mut store, &module) {
        Ok(instance) => instance,
        Err(error) => {
            set_diagnostic(&error.to_string());
            return Err((ERROR_INSTANTIATION, store.data().status_read_count, store.data().ui_input_read_count, memory.data(&store).len() as u32));
        }
    };
    let function = instance
        .get_typed_func::<(), i32>(&store, "run")
        .map_err(|_| (ERROR_EXPORT, store.data().status_read_count, store.data().ui_input_read_count, memory.data(&store).len() as u32))?;
    let result = function
        .call(&mut store, ())
        .map_err(|_| (ERROR_EXECUTION, store.data().status_read_count, store.data().ui_input_read_count, memory.data(&store).len() as u32))?;

    if store.data().ui_output_invalid {
        return Err((ERROR_UI_OUTPUT, store.data().status_read_count, store.data().ui_input_read_count, memory.data(&store).len() as u32));
    }
    if store.data().ui_input_invalid {
        return Err((ERROR_UI_INPUT, store.data().status_read_count, store.data().ui_input_read_count, memory.data(&store).len() as u32));
    }

    Ok((
        result,
        store.data().status_read_count,
        store.data().ui_input_read_count,
        memory.data(&store).len() as u32,
        store.data().ui_output.clone(),
    ))
}
