<template>
  <section class="page-content operations-page" data-admin-scope="webspeak">
    <div class="page-heading"><div><h2>{{ tr('adminInstanceOperations') }}</h2><p>{{ tr('adminInstanceOperationsLead') }}</p></div>
      <button class="secondary-button" type="button" :disabled="operationsLoading" @click="loadOperations"><span v-if="operationsLoading" class="spinner small"></span><Icon v-else name="refresh" :size="17"/>{{ tr('refresh') }}</button>
    </div>
    <nav class="admin-section-nav" :aria-label="tr('adminInstanceOperations')">
      <button v-for="section in sections" :key="section.id" type="button" :aria-current="activeSection === section.id ? 'page' : undefined" @click="activeSection = section.id">{{ section.label }}<span v-if="section.count !== undefined" class="admin-tab-count">{{ section.count }}</span></button>
    </nav>
    <div v-show="activeSection === 'sessions'" class="admin-operations-section" data-admin-section="sessions"><article class="operation-card operation-wide"
        ><header
          ><div
            ><h3>{{ tr("adminBrowserSessions") }}</h3
            ><p>{{ tr("adminBrowserSessionsLead") }}</p></div
          ><strong>{{ operations.sessions.length }}</strong></header
        ><div
          v-if="operations.sessions.length"
          class="table-wrap"
          ><table
            ><thead
              ><tr
                ><th>{{ tr("nickname") }}</th
                ><th>{{ tr("sessionState") }}</th
                ><th>{{ tr("age") }}</th
                ><th>{{ tr("memberCount") }}</th
                ><th></th></tr></thead
            ><tbody
              ><tr
                v-for="session in operations.sessions"
                :key="session.id"
                ><td
                  ><strong>{{ session.nickname }}</strong
                  ><small>{{ session.target }}</small></td
                ><td
                  ><span class="state-pill">{{ sessionStateLabel(session.state) }}</span></td
                ><td>{{ formatAge(session.ageSeconds) }}</td
                ><td>{{ session.memberCount }}</td
                ><td
                  ><button
                    class="danger-button"
                    type="button"
                    :disabled="Boolean(terminatingSession)"
                    @click="terminateSession(session)"
                    >{{
                      terminatingSession === session.id ? tr("terminating") : tr("endSession")
                    }}</button
                  ></td
                ></tr
              ></tbody
            ></table
          ></div
        ><div
          v-else
          class="operation-empty"
          ><Icon
            name="users"
            :size="22"
          /><span>{{ tr("sessionEmpty") }}</span></div
        ></article
      ></div>
    <div v-show="activeSection === 'invites'" class="admin-operations-section" data-admin-section="invites"><article class="operation-card"
        ><header
          ><div
            ><h3>{{ tr("invites") }}</h3
            ><p>{{ tr("adminInviteScope") }}</p></div
          ></header
        ><form
          class="invite-form"
          @submit.prevent="createInvite"
          ><label
            ><span>{{ tr("inviteChannel") }}</span
            ><input
              v-model.trim="inviteForm.channel"
              maxlength="100"
              :placeholder="tr('inviteChannelPlaceholder')" /></label
          ><div class="invite-form-grid"
            ><label
              ><span>{{ tr("expiresIn") }}</span
              ><input
                v-model.number="inviteForm.expiresInHours"
                type="number"
                min="1"
                max="720" /></label
            ><label
              ><span>{{ tr("maxUses") }}</span
              ><input
                v-model.number="inviteForm.maxUses"
                type="number"
                min="0"
                max="10000" /></label></div
          ><small class="field-help">{{ tr("unlimitedUses") }}</small
          ><button
            class="primary-button"
            type="submit"
            :disabled="inviteSubmitting"
            ><span
              v-if="inviteSubmitting"
              class="spinner small"
            ></span
            >{{ tr("createInvite") }}</button
          ></form
        ><div
          v-if="createdInvite"
          class="generated-invite"
          ><strong>{{ tr("inviteCreated") }}</strong
          ><div class="generated-link"
            ><input
              :value="createdInvite.link"
              readonly
            /><button
              class="secondary-button"
              type="button"
              @click="copyInviteLink"
              >{{ tr("copyLink") }}</button
            ></div
          ><small>{{ tr("inviteSecurity") }}</small></div
        ><div
          v-if="operations.invites.length"
          class="invite-list"
          ><div
            v-for="invite in operations.invites"
            :key="invite.id"
            class="invite-row"
            ><div
              ><strong>{{ invite.channel || tr("defaultChannel") }}</strong
              ><small>{{ invite.target }} · {{ formatDate(invite.expiresAt) }}</small></div
            ><div class="invite-row-meta"
              ><span :class="['state-pill', invite.status]">{{
                inviteStatusLabel(invite.status)
              }}</span
              ><span>{{ invite.useCount }}/{{ invite.maxUses || "∞" }}</span
              ><button
                v-if="invite.status === 'active'"
                class="text-danger"
                type="button"
                :disabled="revokingInvites.has(invite.id)"
                @click="revokeInvite(invite)"
                >{{ tr("revoke") }}</button
              ></div
            ></div
          ></div
        ></article
      ></div>
    <div v-show="activeSection === 'logs'" class="admin-operations-section" data-admin-section="logs"><article class="operation-card logs-card"
        ><header
          ><div
            ><h3>{{ tr("logViewer") }}</h3
            ><p>{{ tr("logViewerLead") }}</p></div
          ><span
            v-if="!operations.logs.available"
            class="muted-label"
            >{{ tr("logsUnavailable") }}</span
          ></header
        ><div
          v-if="operations.logs.sessions.length"
          class="connection-list"
          ><div class="connection-history-heading"
            ><strong>{{ tr("connectionHistory") }}</strong
            ><small>{{ tr("connectionHistoryLead") }}</small></div
          ><div
            v-for="record in operations.logs.sessions"
            :key="record.id"
            class="connection-row"
            ><div class="connection-person"
              ><strong>{{ record.nickname }}</strong
              ><small>{{ record.target }}</small
              ><small class="connection-route">{{ connectionRoute(record) }}</small></div
            ><div class="connection-detail"
              ><span :class="['connection-status', record.status]">{{
                connectionStatusLabel(record.status)
              }}</span
              ><small
                >{{ record.connectedAt ? tr("connectedAt") : tr("connectionAttemptedAt") }}：{{
                  formatDate(record.connectedAt || record.startedAt)
                }}</small
              ><small>{{ tr("duration") }}：{{ formatAge(record.durationSeconds) }}</small
              ><small v-if="record.disconnectedAt"
                >{{ tr("disconnectedAt") }}：{{ formatDate(record.disconnectedAt) }}</small
              ><small v-if="record.reason"
                >{{ tr("failureReason") }}：{{ connectionFailureText(record.reason) }}</small
              ><small
                v-if="record.failureDetail"
                class="failure-detail"
                >{{ tr("failureDetail") }}：{{ record.failureDetail }}</small
              ></div
            ></div
          ></div
        ><div
          v-if="operations.logs.entries.length"
          class="log-list"
          ><div
            v-for="(entry, index) in operations.logs.entries"
            :key="`${entry.timestamp}-${index}`"
            class="log-row"
            ><span :class="['log-level', entry.level.toLowerCase()]">{{ entry.level }}</span
            ><div
              ><strong>{{ entry.message || "—" }}</strong
              ><small
                >{{ formatDate(entry.timestamp)
                }}<template v-if="Object.keys(entry.context).length">
                  · {{ formatContext(entry.context) }}</template
                ></small
              ></div
            ></div
          ></div
        ><div
          v-if="!operations.logs.sessions.length && !operations.logs.entries.length"
          class="operation-empty"
          ><Icon
            name="activity"
            :size="22"
          /><span>{{ tr("noLogs") }}</span></div
        ></article
      ></div>
    <div v-show="activeSection === 'audit'" class="admin-operations-section" data-admin-section="audit"><article class="operation-card audit-card"
        ><header
          ><div
            ><h3>{{ tr("audit") }}</h3
            ><p>{{ tr("auditLead") }}</p></div
          ></header
        ><ul class="event-list"
          ><li
            v-for="event in operations.audit"
            :key="`${event.event}-${event.createdAt}`"
            ><span
              ><Icon
                name="check"
                :size="14" /></span
            ><div
              ><strong>{{ eventName(event.event) }}</strong
              ><small>{{ formatDate(event.createdAt) }}</small></div
            ></li
          ><li
            v-if="!operations.audit.length"
            class="empty-event"
            >{{ tr("auditEmpty") }}</li
          ></ul
        ></article
      ></div>
    <div v-show="activeSection === 'maintenance'" class="admin-operations-section" data-admin-section="maintenance"><article class="operation-card diagnostics-card"
        ><header
          ><div
            ><h3>{{ tr("diagnostics") }}</h3
            ><p>{{ tr("diagnosticsLead") }}</p></div
          ><a
            class="text-link"
            href="/api/admin/diagnostics/report"
            >{{ tr("downloadReport") }}</a
          ></header
        ><dl class="diagnostic-list"
          ><div
            ><dt>{{ tr("version") }}</dt
            ><dd>{{ operations.diagnostics.version || "—" }}</dd></div
          ><div
            ><dt>{{ tr("runtime") }}</dt
            ><dd>{{ operations.diagnostics.node || "—" }}</dd></div
          ><div
            ><dt>{{ tr("platform") }}</dt
            ><dd
              >{{ operations.diagnostics.platform || "—" }} /
              {{ operations.diagnostics.arch || "—" }}</dd
            ></div
          ><div
            ><dt>{{ tr("databaseSchema") }}</dt
            ><dd>v{{ operations.diagnostics.schemaVersion || "—" }}</dd></div
          ><div
            ><dt>{{ tr("createdSessions") }}</dt
            ><dd>{{ operations.diagnostics.createdSessions }}</dd></div
          ></dl
        ><button
          class="secondary-button"
          type="button"
          @click="downloadBackup"
          >{{ tr("exportBackup") }}</button
        ></article
      >
      <div class="alert info system-notice"><Icon name="info" :size="16"/><span>{{ tr('updateNotice', {version: operations.diagnostics.version || '—'}) }}</span></div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Icon from "../Icon.vue";
import type { useAdminOperations } from "../../composables/useAdminOperations.js";
import type { useAdminI18n } from "../../composables/useAdminI18n.js";
import type { AdminConnectionRecord } from "../../../../src/shared/admin-responses.js";

const props = defineProps<{
  model: ReturnType<typeof useAdminOperations>;
  initialSection?: string;
  i18n: Pick<ReturnType<typeof useAdminI18n>, "tr" | "formatDate" | "formatAge" | "sessionStateLabel" | "connectionStatusLabel" | "inviteStatusLabel" | "eventName" | "connectionFailureText">;
}>();
// Request ownership, cancellation and drafts remain in the page's controller.
const { operations, operationsLoading, terminatingSession, inviteSubmitting, revokingInvites, inviteForm, createdInvite,
  loadOperations, terminateSession, createInvite, revokeInvite, copyInviteLink, downloadBackup } = props.model;
const { tr, formatDate, formatAge, sessionStateLabel, connectionStatusLabel, inviteStatusLabel, eventName, connectionFailureText } = props.i18n;
type OperationsSection = 'sessions' | 'invites' | 'logs' | 'audit' | 'maintenance';
const normalizeSection = (value?: string): OperationsSection => value === 'invites' || value === 'logs' || value === 'audit' || value === 'maintenance' ? value : 'sessions';
const activeSection = ref<OperationsSection>(normalizeSection(props.initialSection));
watch(() => props.initialSection, value => { activeSection.value = normalizeSection(value); });
const sections = computed(() => [
  { id: 'sessions' as const, label: tr('adminBrowserSessions'), count: operations.sessions.length },
  { id: 'invites' as const, label: tr('invites'), count: operations.invites.length },
  { id: 'logs' as const, label: tr('adminLogsSection'), count: undefined },
  { id: 'audit' as const, label: tr('audit'), count: undefined },
  { id: 'maintenance' as const, label: tr('adminMaintenanceSection'), count: undefined },
]);


function connectionRoute(record: AdminConnectionRecord) {
  const route = tr("connectionFromTo", { ip: record.clientIp || "—", target: record.target || "—" });
  if (!record.relayName && !record.relayTarget) return route;
  const relay = [record.relayName, record.relayTarget].filter(Boolean).join(" · ") || "—";
  return `${route} · ${tr("connectionViaRelay", { relay })}`;
}
function formatContext(context: Record<string, string | number | boolean>) { return Object.entries(context).map(([key, value]) => `${key}=${value}`).join(" · "); }
</script>
