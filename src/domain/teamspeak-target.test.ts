import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

test("protocol identifiers and favorite addresses keep ASCII casing under a Turkish locale", () => {
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { parseTeamSpeakTarget, teamSpeakTargetKey } from './src/domain/teamspeak-target.ts';
    import { quickServerTargetsEqual, mergeQuickServers } from './web/src/services/quick-servers.ts';
    import { normalizeTeamSpeakError } from './src/errors.ts';
    // Windows ignores LANG for ICU's default locale; isolate the Turkish default in this child.
    const localeLower = String.prototype.toLocaleLowerCase;
    String.prototype.toLocaleLowerCase = function(...locales) {
      return localeLower.call(this, ...(locales.length ? locales : ['tr']));
    };
    assert.equal('I'.toLocaleLowerCase(), 'ı', 'the child must actually run under Turkish casing');
    const target = parseTeamSpeakTarget('VOICE.EXAMPLE.IO#9987');
    assert.equal(target.host, 'voice.example.io');
    assert.equal(teamSpeakTargetKey({host:'VOICE.EXAMPLE.IO',port:9987}), 'voice.example.io:9987');
    assert.equal(quickServerTargetsEqual('VOICE.EXAMPLE.IO:9987', 'voice.example.io#9987'), true);
    assert.equal(mergeQuickServers([{id:'a',label:'a',address:'VOICE.EXAMPLE.IO:9987'}],
      [{id:'b',address:'voice.example.io:9987',lastConnectedAt:1}]).length, 1);
    const upper=normalizeTeamSpeakError(new Error('INVALID IDENTITY'));
    const lower=normalizeTeamSpeakError(new Error('invalid identity'));
    assert.equal(upper.code, lower.code);
  `], { env: { ...process.env, LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8" }, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});
