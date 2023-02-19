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

	const centsOut = document.getElementById('cents');
	const noteOut = document.getElementById('note');
	const noteNameOut = document.getElementById('note-name');
	const noteSharpOut = document.getElementById('note-sharp');
	const noteOctaveOut = document.getElementById('note-octave');
	const hzOut = document.getElementById('hz');
	const dbOut = document.getElementById('db');
	const plotCtx = document.getElementById('plot').getContext('2d');

	const highsOut = [...document.getElementById('err-high').children].reverse();
	const lowsOut = [...document.getElementById('err-low').children];
	highsOut.forEach((o, i) => o.style.width = `${i / (highsOut.length - 1) * 20 + 80}%`);
	lowsOut.forEach((o, i) => o.style.width = `${i / (lowsOut.length - 1) * 20 + 80}%`);

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

	const data = new Float32Array(Math.ceil(maxHz / hzConv));

	function updateError(cents) {
		let diff;
		if (cents === null) {
			diff = 0;
			centsOut.value = -50;
			centsOut.textContent = 'no note';
		} else {
			diff = Math.round(cents);
			centsOut.value = diff;
			if (diff === 0) {
				centsOut.textContent = 'perfect';
			} else {
				centsOut.textContent = diff > 0
					? `+ ${diff} cent${diff === 1 ? '' : 's'}`
					: `- ${-diff} cent${diff === -1 ? '' : 's'}`;
			}
		}
		//noteOut.style.left = `${-diff}px`;
		const nH = Math.max(0, Math.round(diff * highsOut.length / 50));
		const nL = Math.max(0, Math.round(-diff * lowsOut.length / 50));
		highsOut.forEach((o, i) => o.classList.toggle('active', i < nH));
		lowsOut.forEach((o, i) => o.classList.toggle('active', i < nL));
		noteOut.classList.toggle('perfect', cents !== null && (nH + nL === 0));
	}

	const MIN_DB = -85;
	const MAX_DB = 10;

	function refresh() {
		const w = plotCtx.canvas.width;
		const h = plotCtx.canvas.height;
		const minPitch = Math.log2(minHz);
		const maxPitch = Math.log2(maxHz);
		analyserNode.getFloatFrequencyData(data);
		plotCtx.clearRect(0, 0, w, h);
		plotCtx.fillStyle = '#FFFFFF';
		plotCtx.beginPath();
		plotCtx.moveTo(-10, h);
		const peak = getPeakDb(data);
			for (let i = Math.floor(minHz / hzConv); i < data.length; ++i) {
			plotCtx.lineTo(
				(Math.log2(i * hzConv) - minPitch) * w / (maxPitch - minPitch),
				Math.min(1, 1 - (data[i] - MIN_DB) / (MAX_DB - MIN_DB)) * h
			);
		}
		plotCtx.lineTo(w + 10, h);
		plotCtx.fill();

		if (peak.db < MIN_DB || peak.i < minHz / hzConv) {
			updateError(null);
			noteNameOut.textContent = '-';
			noteSharpOut.hidden = true;
			noteOctaveOut.textContent = '';
			hzOut.textContent = '-'.padStart(6, ' ');
			dbOut.textContent = '-'.padStart(7, ' ');
		} else {
			const peakHz = peak.i * hzConv;
			const note = noteFromHz(peakHz);
			updateError(note.cents);

			noteNameOut.textContent = note.name.charAt(0);
			noteSharpOut.hidden = !note.name.includes('#');
			noteOctaveOut.textContent = note.octave.toFixed(0);
			hzOut.textContent = peakHz.toFixed(1).padStart(6, ' ');
			dbOut.textContent = peak.db.toFixed(2).padStart(7, ' ');
		}
		requestAnimationFrame(refresh);
	}

	refresh();
}

window.addEventListener('DOMContentLoaded', run);
