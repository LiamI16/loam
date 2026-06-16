import { Channels, VampEngine } from '@loam/core';
import { ToneAudioAdapter } from '@loam/synth-tone';
import * as Tone from 'tone';

const button = document.getElementById('play') as HTMLButtonElement;
const pulse = document.getElementById('pulse') as HTMLDivElement;

let initialised = false;
let playing = false;
let adapter: ToneAudioAdapter | null = null;

function buildAudio(): ToneAudioAdapter {
  // Rhodes-ish FM synth, lifted from ember-generative-study.html.
  const rhodes = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3,
    modulationIndex: 7,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.03, decay: 0.7, sustain: 0.28, release: 2.6 },
    modulation: { type: 'triangle' },
    modulationEnvelope: { attack: 0.02, decay: 0.4, sustain: 0.1, release: 1.2 },
    volume: -11,
  });

  // Simple wet chain — chorus → reverb → output. Just enough to not sound
  // dry while the real signal chain is still in the prototype HTML.
  const reverb = new Tone.Reverb({ decay: 7, preDelay: 0.02, wet: 0.34 }).toDestination();
  const chorus = new Tone.Chorus({ frequency: 0.4, delayTime: 3.5, depth: 0.3, wet: 0.35 })
    .start()
    .connect(reverb);
  rhodes.connect(chorus);

  const a = new ToneAudioAdapter();
  a.registerChannel(Channels.RHODES, rhodes);
  a.setEngine(new VampEngine({ bpm: 74 }));
  a.onTick((ev) => {
    if (ev.beat === 0) flashPulse();
  });
  return a;
}

function flashPulse(): void {
  pulse.classList.add('on');
  setTimeout(() => pulse.classList.remove('on'), 120);
}

button.addEventListener('click', async () => {
  if (!initialised) {
    adapter = buildAudio();
    initialised = true;
  }
  if (!adapter) return;
  if (!playing) {
    await adapter.start();
    button.textContent = 'stop';
    button.classList.add('on');
    playing = true;
  } else {
    adapter.stop();
    button.textContent = 'play';
    button.classList.remove('on');
    playing = false;
  }
});
