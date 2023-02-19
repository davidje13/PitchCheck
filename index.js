'use strict';

const posMod = (a, b) => ((a % b) + b) % b;
const fromDb = (db) => Math.pow(10, db / 10);

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

	const l = fromDb(values[peakI - 1] ?? Number.NEGATIVE_INFINITY);
	const r = fromDb(values[peakI + 1] ?? Number.NEGATIVE_INFINITY);
	const p = fromDb(peakDb);

	return {
		i: peakI + (r - l) * 0.5 / (p - Math.min(l, r)),
		db: peakDb,
	}
}

function getTestSource(audioContext) {
	const audioSource = new OscillatorNode(audioContext, { frequency: noteToHz('C', 4) });
	audioSource.start();

	const freqIn = document.createElement('input');
	freqIn.setAttribute('type', 'number');
	freqIn.setAttribute('min', '1');
	freqIn.setAttribute('max', '22050');
	freqIn.setAttribute('step', '0.1');
	freqIn.setAttribute('value', audioSource.frequency.value.toFixed(1));
	freqIn.addEventListener('input', () => {
		audioSource.frequency.exponentialRampToValueAtTime(
			Math.max(1, Number.parseFloat(freqIn.value)),
			audioContext.currentTime + 0.1,
		);
	});
	document.body.appendChild(freqIn);

	return audioSource;
}

function requestDebug() {
	return new Promise((resolve) => {
		const btn = document.createElement('button');
		btn.textContent = 'Run in test mode';
		document.body.appendChild(btn);
		const next = () => {
			document.body.removeChild(btn);
			resolve(null);
		};
		btn.addEventListener('click', next, { once: true });
	});
}

async function run() {
	const minHz = noteToHz('A', 1, -50);
	const maxHz = noteToHz('A', 7, 50);
	const minDb = -85;
	const maxDb = 10;

	const ui = new UI();

	const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
		.catch(requestDebug);
	const audioContext = new AudioContext({
		latencyHint: 'playback',
		sampleRate: 44100,
		sinkId: { type: 'none' },
	});

	const audioSource = mediaStream
		? new MediaStreamAudioSourceNode(audioContext, { mediaStream: mediaStream })
		: getTestSource(audioContext);

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
			ui.showDecibels(peak.db);
		}
		ui.showFrequencyDomain(data, hzConv, minHz, maxHz, minDb, maxDb);

		requestAnimationFrame(refresh);
	}

	refresh();
}

class UI {
	constructor() {
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
