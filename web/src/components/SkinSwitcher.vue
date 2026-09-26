<template>
  <div ref="root" class="skin-switcher" :class="{ open }" @keydown.esc="close">
    <button
      type="button"
      class="skin-trigger"
      data-ws-part="skin.trigger"
      :aria-label="menuLabel"
      :title="`${menuLabel}: ${selectedOption.label}`"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :data-ws-state="open ? 'open' : 'closed'"
      :aria-controls="menuId"
      @click.stop="toggle"
    >
      <Icon :name="selectedOption.icon || 'compass'" :size="15" />
      <span>{{ menuLabel }}</span>
      <Icon name="chevron-down" :size="12" />
    </button>

    <div v-if="open" :id="menuId" class="skin-dropdown" data-ws-part="skin.menu" role="listbox" :aria-label="menuLabel" @click.stop>
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        class="skin-option"
        data-ws-part="skin.option"
        :data-ws-skin-id="option.value"
        :class="{ selected: modelValue === option.value }"
        role="option"
        :aria-selected="modelValue === option.value"
        @click="select(option.value)"
      >
        <Icon :name="option.icon || 'compass'" :size="16" />
        <span>{{ option.label }}</span>
        <Icon v-if="modelValue === option.value" name="check" :size="14" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import Icon from "./Icon.vue";

export interface SkinOption {
  value: string;
  label: string;
  icon?: string;
}

const props = defineProps<{
  modelValue: string;
  menuLabel: string;
  options: SkinOption[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  change: [value: string];
}>();

const options = computed(() => props.options);
const selectedOption = computed(() => options.value.find((option) => option.value === props.modelValue) ?? options.value[0]);
const root = ref<HTMLElement | null>(null);
const open = ref(false);
const menuId = `skin-menu-${Math.random().toString(36).slice(2, 9)}`;

function toggle() { open.value = !open.value; }
function close() { open.value = false; }
function select(value: string) {
  emit("update:modelValue", value);
  emit("change", value);
  close();
}
function onDocumentPointerDown(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) close();
}

onMounted(() => document.addEventListener("pointerdown", onDocumentPointerDown));
onUnmounted(() => document.removeEventListener("pointerdown", onDocumentPointerDown));
</script>

<style scoped>
.skin-switcher {
  position: relative;
  z-index: 20;
  flex: 0 0 auto;
  color: var(--text-muted);
}

.skin-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 34px;
  min-height: 32px;
  padding: 0 8px;
  color: #08766f;
  background: rgba(250, 254, 255, .94);
  border: 1px solid #c8e6e1;
  border-radius: 8px;
  font: inherit;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(8, 126, 134, .08);
  transition: color .16s, background .16s, border-color .16s, box-shadow .16s;
}

.skin-trigger:hover,
.skin-switcher.open .skin-trigger {
  color: #056e76;
  background: #edfafa;
  border-color: #8fd7d9;
  box-shadow: 0 6px 16px rgba(30, 170, 184, .14);
}

.skin-trigger > .ui-icon:last-child { margin-left: 1px; }

.skin-dropdown {
  position: absolute;
  top: calc(100% + 7px);
  right: 0;
  display: grid;
  gap: 3px;
  min-width: 176px;
  padding: 6px;
  color: #123849;
  background: linear-gradient(145deg, rgba(250, 255, 255, .99), rgba(232, 249, 250, .98));
  border: 1px solid rgba(104, 196, 211, .58);
  border-radius: 11px;
  box-shadow: 0 18px 42px rgba(29, 115, 139, .2), inset 0 1px 0 rgba(255, 255, 255, .96);
  backdrop-filter: blur(18px) saturate(1.12);
}

.skin-option {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 36px;
  padding: 0 9px;
  color: #123849;
  background: rgba(255, 255, 255, .62);
  border: 1px solid rgba(255, 255, 255, .5);
  border-radius: 7px;
  font: inherit;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}

.skin-option > .ui-icon:first-child { color: #64858a; }
.skin-option > .ui-icon:last-child { margin-left: auto; color: #087e86; }
.skin-option:hover,
.skin-option:focus-visible,
.skin-option.selected {
  color: #087e86;
  background: rgba(211, 245, 248, .92);
  border-color: rgba(71, 201, 212, .42);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .82);
}

@media (max-width: 520px) {
  .skin-trigger { min-height: 36px; }
  .skin-dropdown { min-width: 190px; }
}

.skin-switcher.mobile-skin-switcher .skin-trigger {
  width: 100%;
  min-height: 44px;
  justify-content: flex-start;
  padding-inline: 12px;
  font-size: 12px;
}

@media (max-width: 420px) {
  .skin-switcher.join-skin-switcher .skin-trigger {
    width: 28px;
    min-width: 28px;
    min-height: 28px;
    padding: 0;
  }

  .skin-switcher.join-skin-switcher .skin-trigger > span,
  .skin-switcher.join-skin-switcher .skin-trigger > .ui-icon:last-child { display: none; }
}
</style>
