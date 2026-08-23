/* Hum2Song Studio - shared browser audio decode helper.
 * Keeps Web Audio setup and decodeAudioData in one place for waveform and analysis.
 */
(function(root, factory){
  'use strict';
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.H2SAudioDecode = api;
})(typeof window !== 'undefined' ? window : globalThis, function(root){
  'use strict';

  function getAudioContextCtor(){
    if (!root) return null;
    return root.AudioContext || root.webkitAudioContext || null;
  }

  async function decodeAudioFile(file, options){
    options = options || {};
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('audio_source_unreadable');
    var AC = options.AudioContext || getAudioContextCtor();
    if (!AC) throw new Error('no_audio_context');
    var context = new AC();
    try{
      var bytes = await file.arrayBuffer();
      if (!bytes || !bytes.byteLength) throw new Error('audio_source_empty');
      return await context.decodeAudioData(bytes.slice(0));
    } finally {
      try{
        if (context && typeof context.close === 'function') await context.close();
      }catch(_closeErr){}
    }
  }

  return { decodeAudioFile: decodeAudioFile };
});
