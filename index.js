'use strict';

const posMod = (a, b) => ((a % b) + b) % b;
// sound intensity can be considered linear, so we use /10 as our base, not /20 (which would be pressure; non-linear)
const soundIntensityFromDb = (db) => Math.pow(10, db / 10); // * 1e-12 to scale, but we do not need the scale anywhere

// web audio API does not use a reference intensity, so we must add it ourselves (using 20 micropascals)
// (being able to get absolute values out depends on the hardware attenuation/gain being known, so this is possibly a lost cause anyway)
// for this reference we use *20 as our base, not *10, since this is a reference pressure
const SPL_0DB = 20 * Math.log10(20e-6);

const A4 = 440;
const NOTES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];

function noteFromHz(hz) {
	if (hz <= 0) {
		return null;
	}
	const lnHz = Math.log2(hz / A4) * 12;
	const lnHzI = Math.round(lnHz);
	return {
		octave: Math.floor(lnHzI / 12) + 4,
		name: NOTES[posMod(lnHzI, 12)],
		cents: (lnHz - lnHzI) * 100,
	};
}

function noteToHz(name, octave, cents = 0) {
	const semitone = NOTES.indexOf(name);
	return Math.pow(2, octave - 4 + semitone / 12 + cents / 1200) * A4;
}

function getPeakDb(values) {
	let peakI = -1;
	let peakDb = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < values.length; ++i) {
		if (values[i] > peakDb) {
			peakDb = values[i];
			peakI = i;
		}
	}

	const l = soundIntensityFromDb(values[peakI - 1] ?? Number.NEGATIVE_INFINITY);
	const r = soundIntensityFromDb(values[peakI + 1] ?? Number.NEGATIVE_INFINITY);
	const p = soundIntensityFromDb(peakDb);

	return {
		i: peakI + (r - l) * 0.5 / (p - Math.min(l, r)),
		db: peakDb,
	};
}

function getTotalDb(values, hzConv) {
	let sumIntensity = 0;
	// "Z" weighting
	const minI = Math.ceil(20 / hzConv);
	const maxI = Math.min(Math.ceil(20000 / hzConv), values.length);
	for (let i = minI; i < maxI; ++i) {
		sumIntensity += soundIntensityFromDb(values[i]);
	}
	sumIntensity *= hzConv; // scale integration to 1hz per sample

	return 10 * Math.log10(sumIntensity);
}

function getTestSource(audioContext) {
	const audioSource = new OscillatorNode(audioContext, { frequency: 1e-2 });
	const gainNode = new GainNode(audioContext, { gain: 0.125 });
	audioSource.connect(gainNode);
	audioSource.start();

	const freqIn = document.createElement('input');
	freqIn.className = 'debugHz';
	freqIn.setAttribute('title', 'Debug frequency');
	freqIn.setAttribute('type', 'number');
	freqIn.setAttribute('min', '0');
	freqIn.setAttribute('max', '22050');
	freqIn.setAttribute('step', '0.1');
	freqIn.setAttribute('value', '0');
	freqIn.addEventListener('input', () => {
		const value = Number.parseFloat(freqIn.value);
		if (Number.isNaN(value) || value <= 0) {
			audioSource.frequency.exponentialRampToValueAtTime(1e-2, audioContext.currentTime + 0.1);
		} else {
			audioSource.frequency.exponentialRampToValueAtTime(value, audioContext.currentTime + 0.1);
		}
	});
	document.body.appendChild(freqIn);

	return gainNode;
}

const playing = new Set();

function silenceNotes(audioContext) {
	const now = audioContext.currentTime;
	playing.forEach(({ audioSource, gainNode }) => {
		gainNode.gain.cancelAndHoldAtTime(now);
		gainNode.gain.linearRampToValueAtTime(0, now + 0.1);
		audioSource.stop(now + 0.1);
	});
	playing.clear();
}

function playNote(audioContext, frequency, { fadeIn = 0.02, life = 0.0, fadeOut = 1.0, gain = 1 } = {}) {
	const audioSource = new OscillatorNode(audioContext, { frequency });
	const gainNode = new GainNode(audioContext, { gain: 0 });
	audioSource.connect(gainNode);
	gainNode.connect(audioContext.destination);

	const beginTime = audioContext.currentTime + 0.02;
	gainNode.gain.linearRampToValueAtTime(gain * 1e-4, beginTime);
	gainNode.gain.exponentialRampToValueAtTime(gain, beginTime + fadeIn);
	gainNode.gain.linearRampToValueAtTime(gain, beginTime + fadeIn + life);
	gainNode.gain.exponentialRampToValueAtTime(gain * 1e-4, beginTime + fadeIn + life + fadeOut);
	gainNode.gain.linearRampToValueAtTime(0, beginTime + fadeIn + life + fadeOut + 0.02);

	audioSource.start(beginTime);
	audioSource.stop(beginTime + fadeIn + life + fadeOut + 0.02);

	const playingItem = { audioSource, gainNode };
	playing.add(playingItem);
	setTimeout(() => playing.delete(playingItem), (beginTime + fadeIn + life + fadeOut) * 1000);
}

async function run() {
	const minHz = noteToHz('A', 1, -50);
	const maxHz = noteToHz('A', 7, 50);
	const minDb = -85;
	const maxDb = 10;

	const ui = new UI();

	let pendingNoteEvent = null;
	const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
		.catch(() => new Promise((resolve) => {
			ui.addEventListener('playnote', (e) => {
				pendingNoteEvent = e;
				resolve(null);
			}, { once: true });
		}));
	const audioContext = new AudioContext({
		latencyHint: 'playback',
		sampleRate: 44100,
	});

	const audioSource = mediaStream
		? new MediaStreamAudioSourceNode(audioContext, { mediaStream })
		: getTestSource(audioContext);

	function handlePlayNote(e) {
		silenceNotes(audioContext);
		playNote(
			audioContext,
			noteToHz(e.detail.note, e.detail.octave),
			{ fadeIn: 0.05, life: 5.0, fadeOut: 8.0, gain: 0.8 },
		);
	}
	ui.addEventListener('playnote', handlePlayNote);
	if (pendingNoteEvent) {
		handlePlayNote(pendingNoteEvent);
	}

	const analyserNode = new AnalyserNode(audioContext, {
		fftSize: 1024 * 8,
		smoothingTimeConstant: 0.5,
	});
	audioSource.connect(analyserNode);

	const hzConv = analyserNode.context.sampleRate / analyserNode.fftSize;
	const data = new Float32Array(Math.ceil(Math.min(
		maxHz * 1.1 / hzConv,
		analyserNode.fftSize / 2,
	)));

	function refresh() {
		analyserNode.getFloatFrequencyData(data);
		const peak = getPeakDb(data);
		const peakHz = peak.i * hzConv;

		if (peak.db < minDb || peakHz < minHz || peakHz > maxHz) {
			ui.showNote(null);
			ui.showDecibels(null);
		} else {
			ui.showNote(peakHz);
			ui.showDecibels(getTotalDb(data, hzConv) - SPL_0DB);
		}
		ui.showFrequencyDomain(data, hzConv, minHz, maxHz, minDb, maxDb);

		requestAnimationFrame(refresh);
	}

	refresh();
}

class UI extends EventTarget {
	constructor() {
		super();
		this.centsOut = document.getElementById('cents');
		this.noteOut = document.getElementById('note');
		this.noteNameOut = document.getElementById('note-name');
		this.noteSharpOut = document.getElementById('note-sharp');
		this.noteOctaveOut = document.getElementById('note-octave');
		this.hzOut = document.getElementById('hz');
		this.dbOut = document.getElementById('db');
		this.plotCtx = document.getElementById('plot').getContext('2d');

		this.highsOut = [...document.getElementById('err-high').children].reverse();
		this.lowsOut = [...document.getElementById('err-low').children];
		this.highsOut.forEach((o, i) => o.style.width = `${i / (this.highsOut.length - 1) * 20 + 80}%`);
		this.lowsOut.forEach((o, i) => o.style.width = `${i / (this.lowsOut.length - 1) * 20 + 80}%`);

		for (const button of document.getElementsByTagName('button')) {
			if (button.dataset['note']) {
				const note = button.dataset['note'];
				const octave = Number.parseInt(button.dataset['octave'] ?? '4');
				button.addEventListener('click', () => {
					this.dispatchEvent(new CustomEvent('playnote', { detail: { note, octave } }));
				});
			}
		}

		this.baseTitle = document.title;
	}

	showError(cents) {
		let diff;
		if (cents === null) {
			diff = 0;
			this.centsOut.value = -50;
			this.centsOut.textContent = 'no note';
		} else {
			diff = Math.round(cents);
			this.centsOut.value = diff;
			if (diff === 0) {
				this.centsOut.textContent = 'perfect';
			} else {
				this.centsOut.textContent = diff > 0
					? `+ ${diff} cent${diff === 1 ? '' : 's'}`
					: `- ${-diff} cent${diff === -1 ? '' : 's'}`;
			}
		}
		//noteOut.style.left = `${-diff}px`;
		const nH = Math.max(0, Math.round(diff * this.highsOut.length / 50));
		const nL = Math.max(0, Math.round(-diff * this.lowsOut.length / 50));
		this.highsOut.forEach((o, i) => o.classList.toggle('active', i < nH));
		this.lowsOut.forEach((o, i) => o.classList.toggle('active', i < nL));
		this.noteOut.classList.toggle('perfect', cents !== null && (nH + nL === 0));
	}

	showNote(hz) {
		let hzText = '-';
		if (hz !== null) {
			const note = noteFromHz(hz);
			this.showError(note.cents);
			this.noteNameOut.textContent = note.name.charAt(0);
			this.noteSharpOut.hidden = !note.name.includes('#');
			this.noteOctaveOut.textContent = note.octave.toFixed(0);
			hzText = hz.toFixed(1);
		} else {
			this.showError(null);
			this.noteNameOut.textContent = '-';
			this.noteSharpOut.hidden = true;
			this.noteOctaveOut.textContent = '';
		}
		this.hzOut.textContent = hzText.padStart(6, ' ');
	}

	showDecibels(db) {
		let dbText = '-';
		if (db !== null) {
			dbText = db.toFixed(2);
		}
		this.dbOut.textContent = dbText.padStart(7, ' ');
	}

	showFrequencyDomain(data, hzConv, minHz, maxHz, minDb, maxDb) {
		const w = this.plotCtx.canvas.width;
		const h = this.plotCtx.canvas.height;
		const minPitch = Math.log2(minHz);
		const maxPitch = Math.log2(maxHz);
		const minI = Math.floor(minHz / hzConv);
		const maxI = Math.min(data.length, Math.ceil(maxHz / hzConv));
		const pitchScale = w / (maxPitch - minPitch);
		const dbScale = h / (maxDb - minDb);
		this.plotCtx.clearRect(0, 0, w, h);
		this.plotCtx.fillStyle = '#FFFFFF';
		this.plotCtx.beginPath();
		this.plotCtx.moveTo(-10, h);
		for (let i = minI; i < maxI; ++i) {
			this.plotCtx.lineTo(
				(Math.log2(i * hzConv) - minPitch) * pitchScale,
				(maxDb - data[i]) * dbScale,
			);
		}
		this.plotCtx.lineTo(w + 10, h);
		this.plotCtx.fill();
	}
}

window.addEventListener('DOMContentLoaded', run);
