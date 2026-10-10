<template>
  <div
    ref="root"
    class="settings-device-select"
    data-ws-part="voice.audio-settings.device-select"
  >
    <button
      :id="id"
      ref="trigger"
      type="button"
      class="settings-select"
      role="combobox"
      aria-haspopup="listbox"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="listboxId"
      :aria-activedescendant="open && activeIndex >= 0 ? optionId(activeIndex) : undefined"
      :disabled="disabled"
      data-ws-part="voice.audio-settings.device-select-trigger"
      @click="toggle"
      @keydown="onKeydown"
    >
      <span class="settings-select-label">{{ selectedOption?.label ?? "" }}</span>
      <span
        class="settings-select-chevron"
        aria-hidden="true"
        data-ws-part="voice.audio-settings.device-select-chevron"
      ></span>
    </button>
    <Transition name="settings-select-menu">
      <ul
        v-if="open"
        :id="listboxId"
        class="settings-select-menu"
        role="listbox"
        :aria-label="label"
        :style="menuStyle"
        data-ws-part="voice.audio-settings.device-select-menu"
      >
        <li
          v-for="(option, index) in options"
          :id="optionId(index)"
          :key="index"
          class="settings-select-option"
          :class="{ active: index === activeIndex }"
          role="option"
          :aria-selected="option.value === modelValue"
          data-ws-part="voice.audio-settings.device-select-option"
          @pointermove="activeIndex = index"
          @click="select(option)"
        >
          {{ option.label }}
        </li>
      </ul>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from "vue";

export interface AudioDeviceOption {
  value: string;
  label: string;
}

const props = withDefaults(defineProps<{
  id: string;
  modelValue: string;
  options: readonly AudioDeviceOption[];
  label: string;
  disabled?: boolean;
}>(), { disabled: false });
const emit = defineEmits<{ change: [value: string] }>();

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const open = ref(false);
const activeIndex = ref(-1);
const menuStyle = ref<CSSProperties>({});
const listboxId = computed(() => `${props.id}-listbox`);
const selectedIndex = computed(() => props.options.findIndex(option => option.value === props.modelValue));
const selectedOption = computed(() => props.options[selectedIndex.value] ?? props.options[0]);
let typeahead = "";
let typeaheadTimeout: ReturnType<typeof setTimeout> | undefined;

function optionId(index: number): string {
  return `${listboxId.value}-option-${index}`;
}

function updateMenuPosition(): void {
  const rect = trigger.value?.getBoundingClientRect();
  if (!rect || typeof window === "undefined") return;

  const fullHeight = Math.min(240, props.options.length * 32 + 8);
  const below = Math.max(0, window.innerHeight - rect.bottom - 8);
  const above = Math.max(0, rect.top - 8);
  const opensAbove = below < fullHeight && above > below;
  const available = opensAbove ? above : below;
  const height = Math.min(fullHeight, Math.max(80, available));
  const top = opensAbove ? Math.max(8, rect.top - height - 4) : Math.min(rect.bottom + 4, window.innerHeight - height - 8);

  menuStyle.value = {
    top: `${top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    maxHeight: `${height}px`,
  };
}

function setOpen(next: boolean): void {
  if (props.disabled && next) return;
  if (next === open.value) return;
  if (next) activeIndex.value = Math.max(0, selectedIndex.value);
  open.value = next;
  if (next) void nextTick(() => {
    updateMenuPosition();
    scrollActiveIntoView();
  });
}

function toggle(): void {
  setOpen(!open.value);
}

function moveActive(delta: number): void {
  const count = props.options.length;
  if (!count) return;
  activeIndex.value = (activeIndex.value + delta + count) % count;
  scrollActiveIntoView();
}

function scrollActiveIntoView(): void {
  void nextTick(() => {
    document.getElementById(optionId(activeIndex.value))?.scrollIntoView({ block: "nearest" });
  });
}

function select(option: AudioDeviceOption): void {
  emit("change", option.value);
  setOpen(false);
  void nextTick(() => trigger.value?.focus());
}

function typeaheadMatch(key: string): void {
  typeahead += key.toLocaleLowerCase();
  if (typeaheadTimeout) clearTimeout(typeaheadTimeout);
  typeaheadTimeout = setTimeout(() => { typeahead = ""; }, 700);

  const start = Math.max(0, activeIndex.value + 1);
  const ordered = [...props.options.slice(start), ...props.options.slice(0, start)];
  const match = ordered.find(option => option.label.toLocaleLowerCase().startsWith(typeahead));
  if (match) {
    activeIndex.value = props.options.indexOf(match);
    scrollActiveIntoView();
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!open.value) {
      setOpen(true);
      return;
    }
    moveActive(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    if (!open.value) setOpen(true);
    activeIndex.value = event.key === "Home" ? 0 : props.options.length - 1;
    scrollActiveIntoView();
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (!open.value) setOpen(true);
    else if (props.options[activeIndex.value]) select(props.options[activeIndex.value]);
    return;
  }
  if (event.key === "Escape" && open.value) {
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    return;
  }
  if (event.key === "Tab") {
    setOpen(false);
    return;
  }
  if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
    if (!open.value) setOpen(true);
    typeaheadMatch(event.key);
  }
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) setOpen(false);
}

function onWindowChange(): void {
  if (open.value) updateMenuPosition();
}

watch(() => props.disabled, disabled => { if (disabled) setOpen(false); });
watch(() => props.options, options => {
  if (activeIndex.value >= options.length) activeIndex.value = Math.max(0, options.length - 1);
});

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  window.addEventListener("resize", onWindowChange);
  window.addEventListener("scroll", onWindowChange, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  window.removeEventListener("resize", onWindowChange);
  window.removeEventListener("scroll", onWindowChange, true);
  if (typeaheadTimeout) clearTimeout(typeaheadTimeout);
});
</script>
