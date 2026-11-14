<template>
  <div class="config-value">
    <select v-if="!fixed" :aria-label="labels.type" :value="kind" @change="changeType">
      <option v-for="type in types" :key="type">{{ type }}</option>
    </select>
    <template v-if="objectRows">
      <div v-for="[key, value] in objectRows" :key="key" class="config-row">
        <span class="config-key">{{ key }}</span>
        <PluginConfigValue :model-value="value" :labels="labels" :secret="secret" :fixed="stringChildren" @update:model-value="setKey(key, $event)" />
        <button type="button" :aria-label="`${labels.remove} ${key}`" @click="removeKey(key)">×</button>
      </div>
      <div class="config-add">
        <input v-model="newKey" :aria-label="labels.key" :placeholder="labels.key" autocomplete="off" @keydown.enter.prevent="addKey" />
        <button type="button" :disabled="!canAddKey" @click="addKey">{{ labels.add }}</button>
      </div>
    </template>
    <template v-else-if="Array.isArray(modelValue)">
      <div v-for="(value, index) in modelValue" :key="index" class="config-row">
        <span class="config-key">{{ index + 1 }}</span>
        <PluginConfigValue :model-value="value" :labels="labels" :secret="secret" :fixed="stringChildren" @update:model-value="setItem(index, $event)" />
        <button type="button" :aria-label="`${labels.remove} ${index + 1}`" @click="removeItem(index)">×</button>
      </div>
      <button type="button" @click="emit('update:modelValue', [...modelValue, ''])">{{ labels.add }}</button>
    </template>
    <select v-else-if="typeof modelValue === 'boolean'" :aria-label="labels.value" :value="String(modelValue)" @change="emit('update:modelValue', inputValue($event) === 'true')">
      <option value="true">true</option>
      <option value="false">false</option>
    </select>
    <input v-else-if="typeof modelValue === 'number'" :aria-label="labels.value" type="number" step="any" :value="modelValue" @input="setNumber" />
    <input v-else-if="typeof modelValue === 'string'" :aria-label="labels.value" :type="secret ? 'password' : 'text'" :value="modelValue" :autocomplete="secret ? 'new-password' : 'off'" spellcheck="false" @input="emit('update:modelValue', inputValue($event))" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { JsonValue } from '../../../../src/shared/plugins.js';

const props = defineProps<{
  modelValue: JsonValue;
  labels: { type: string; key: string; value: string; add: string; remove: string };
  secret?: boolean;
  fixed?: boolean;
  stringChildren?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: JsonValue] }>();
const defaults: Record<string, JsonValue> = { text: '', number: 0, boolean: false, list: [], object: {}, null: null };
const types = Object.keys(defaults);
const kind = computed(() => {
  const value = props.modelValue;
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'list';
  return typeof value === 'string' ? 'text' : typeof value;
});
const objectValue = computed(() => kind.value === 'object' ? props.modelValue as Record<string, JsonValue> : null);
const objectRows = computed(() => objectValue.value && Object.entries(objectValue.value));
const newKey = ref('');
const canAddKey = computed(() => Boolean(newKey.value.trim()) && !Object.hasOwn(objectValue.value ?? {}, newKey.value.trim()));

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}
function changeType(event: Event) {
  const type = inputValue(event);
  if (Object.hasOwn(defaults, type)) emit('update:modelValue', defaults[type]);
}
function setNumber(event: Event) {
  const value = (event.target as HTMLInputElement).valueAsNumber;
  if (Number.isFinite(value)) emit('update:modelValue', value);
}
function setKey(key: string, value: JsonValue) {
  emit('update:modelValue', {...objectValue.value, [key]:value});
}
function addKey() {
  if (!canAddKey.value) return;
  setKey(newKey.value.trim(), '');
  newKey.value = '';
}
function removeKey(key: string) {
  const next = {...objectValue.value};
  delete next[key];
  emit('update:modelValue', next);
}
function setItem(index: number, value: JsonValue) {
  if (!Array.isArray(props.modelValue)) return;
  emit('update:modelValue', props.modelValue.map((item, i) => i === index ? value : item));
}
function removeItem(index: number) {
  if (!Array.isArray(props.modelValue)) return;
  emit('update:modelValue', props.modelValue.filter((_, i) => i !== index));
}
</script>

<style scoped>
.config-value{min-width:0;display:grid;gap:8px;align-content:start}
.config-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) auto;align-items:start;gap:8px}
.config-key{padding-top:9px;overflow-wrap:anywhere}
.config-add{display:flex;gap:8px}
.config-value :is(input,select,button){box-sizing:border-box;min-width:0;padding:7px 9px;border:1px solid var(--admin-border);border-radius:8px;background:var(--admin-field);color:var(--admin-text)}
.config-add input{flex:1}
.config-value>button,.config-value>select{justify-self:start}
@media(max-width:600px){.config-row{grid-template-columns:minmax(0,1fr) auto}.config-key{grid-column:1/-1;padding-top:0}}
</style>
