function gaussianRandom(target, mean = 0, std = 1) {
	// box-muller transform (generate gaussian random samples)
	for (let i = 0, e = target.length - 1; i < e; i += 2) {
		const u = Math.sqrt(-2 * Math.log(Math.random())) * std;
		const v = Math.random() * Math.PI * 2;
		target[i] = u * Math.sin(v) + mean;
		target[i + 1] = u * Math.cos(v) + mean;
	}
	if (target.length & 1) {
		const u = Math.sqrt(-2 * Math.log(Math.random())) * std;
		const v = Math.random() * Math.PI * 2;
		target[target.length - 1] = u * Math.sin(v) + mean;
	}
}

function createWhiteNoise(audioContext, duration) {
	const buffer = audioContext.createBuffer(1, Math.ceil(audioContext.sampleRate * duration), audioContext.sampleRate);
	gaussianRandom(buffer.getChannelData(0), 0, 1);
	return buffer;
}

function createBrownianNoise(audioContext, duration, { leak = 0, limit = Number.POSITIVE_INFINITY, loopFriendly = true, gain = 1 } = {}) {
	const buffer = audioContext.createBuffer(1, Math.ceil(audioContext.sampleRate * duration), audioContext.sampleRate);
	const data = buffer.getChannelData(0);
	gaussianRandom(data);
	const n = data.length;
	const m = 1 - leak;
	for (let i = 0, integral = 0; i < n; ++i) {
		integral = integral * m + data[i];
		if (integral > limit || integral < -limit) {
			integral -= data[i] * 2;
		}
		data[i] = integral * gain;
	}
	if (loopFriendly) {
		// avoid clicking on loop boundary
		const drift = data[n - 1] / n;
		for (let i = 0; i < n; ++i) {
			data[i] -= drift * i;
		}
	}
	return buffer;
}
