/* Hum2Song Studio — internal assistant skill metadata (MVP slice).
 * Not user-configurable. Sits above H2SInternalActionRegistry: describes assistant-facing
 * labels/targets/policies; execution remains runCommand → executeBounded.
 * Slice: add_clip_to_timeline, add_track, move_instance, remove_instance (confirm UI stays assistant-side).
 */
(function (ROOT) {
  'use strict';

  var TARGET = { none: 'none', selected_instance: 'selected_instance' };
  var CONFIRM = { never: 'never', assistant_remove_instance: 'assistant_remove_instance' };

  /**
   * @typedef {Object} InternalAssistantSkill
   * @property {string} skillId
   * @property {string} commandId — bounded runCommand name
   * @property {string} target
   * @property {string} confirmPolicy
   * @property {boolean} enabled
   * @property {string} [phraseResolverId] — implemented in app.js for this slice
   * @property {{ running: string, ok: string, fail: string, skillDisabled: string, clamp?: string, dirLeft?: string, dirRight?: string }} i18n
   */

  var SKILLS = {
    add_clip_to_timeline: {
      skillId: 'add_clip_to_timeline',
      commandId: 'add_clip_to_timeline',
      target: TARGET.none,
      confirmPolicy: CONFIRM.never,
      enabled: true,
      phraseResolverId: 'assistant_add_clip_to_timeline_v1',
      i18n: {
        running: 'aiAssist.addClipToTimelineRunning',
        ok: 'aiAssist.addClipToTimelineOk',
        fail: 'aiAssist.addClipToTimelineFail',
        skillDisabled: 'aiAssist.skillDisabled',
      },
    },
    add_track: {
      skillId: 'add_track',
      commandId: 'add_track',
      target: TARGET.none,
      confirmPolicy: CONFIRM.never,
      enabled: true,
      phraseResolverId: 'assistant_add_track_v1',
      i18n: {
        running: 'aiAssist.addTrackRunning',
        ok: 'aiAssist.addTrackOk',
        fail: 'aiAssist.addTrackFail',
        skillDisabled: 'aiAssist.skillDisabled',
      },
    },
    move_instance: {
      skillId: 'move_instance',
      commandId: 'move_instance',
      target: TARGET.selected_instance,
      confirmPolicy: CONFIRM.never,
      enabled: true,
      phraseResolverId: 'assistant_move_instance_v1',
      i18n: {
        running: 'aiAssist.moveInstanceRunning',
        ok: 'aiAssist.moveInstanceOk',
        okTrack: 'aiAssist.moveInstanceOkTrack',
        fail: 'aiAssist.moveInstanceFail',
        clamp: 'aiAssist.moveInstanceClamped',
        dirLeft: 'aiAssist.dirLeft',
        dirRight: 'aiAssist.dirRight',
        skillDisabled: 'aiAssist.skillDisabled',
      },
    },
    remove_instance: {
      skillId: 'remove_instance',
      commandId: 'remove_instance',
      target: TARGET.selected_instance,
      confirmPolicy: CONFIRM.assistant_remove_instance,
      enabled: true,
      phraseResolverId: 'assistant_remove_instance_v1',
      i18n: {
        running: 'aiAssist.removeInstanceRunning',
        ok: 'aiAssist.removeInstanceOk',
        fail: 'aiAssist.removeInstanceFail',
        skillDisabled: 'aiAssist.skillDisabled',
      },
    },
  };

  function getSkill(skillId) {
    return SKILLS[skillId] || null;
  }

  function assistantSkillIds() {
    return Object.keys(SKILLS).sort();
  }

  /**
   * Only commands listed in SKILLS participate; must still be bounded in the action registry.
   * @param {string} commandId
   * @returns {boolean}
   */
  function isAssistantSkillEnabled(commandId) {
    var s = SKILLS[commandId];
    if (!s || !s.enabled) return false;
    var AR = ROOT.H2SInternalActionRegistry;
    if (AR && typeof AR.isBounded === 'function' && !AR.isBounded(commandId)) return false;
    return true;
  }

  /** @internal tests only */
  function _setSkillEnabledForTest(skillId, enabled) {
    if (SKILLS[skillId]) SKILLS[skillId].enabled = !!enabled;
  }

  ROOT.H2SInternalSkillRegistry = {
    TARGET: TARGET,
    CONFIRM: CONFIRM,
    getSkill: getSkill,
    assistantSkillIds: assistantSkillIds,
    isAssistantSkillEnabled: isAssistantSkillEnabled,
    _setSkillEnabledForTest: _setSkillEnabledForTest,
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
