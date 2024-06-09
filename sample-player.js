class SamplePlayer {
	constructor(audioContext) {
		this.playing = new Set();
		this.audioContext = audioContext;
	}

	silenceNotes() {
		const now = this.audioContext.currentTime;
		this.playing.forEach(({ audioSource, gainNode }) => {
			if (gainNode.gain.cancelAndHoldAtTime) {
				gainNode.gain.cancelAndHoldAtTime(now);
			} else {
				// firefox does not support cancelAndHoldAtTime - use a crude approximation reduce the clicking sounds
				gainNode.gain.setValueAtTime(gainNode.gain.value * 1.15, now); // 1.15 found by experiment to reduce clicking the most (not sure why!)
			}
			gainNode.gain.linearRampToValueAtTime(0, now + 0.1);
			audioSource.stop(now + 0.1);
		});
		this.playing.clear();
	}

	isPlaying(checkID) {
		for (const { id } of this.playing) {
			if (id === checkID) {
				return true;
			}
		}
		return false;
	}

	play(id, audioSource, gainNode, beginTime = null, duration = Number.POSITIVE_INFINITY) {
		if (beginTime === null) {
			beginTime = this.audioContext.currentTime;
		}
		const playingItem = { audioSource, gainNode, id };
		this.playing.add(playingItem);
		audioSource.start(beginTime);
		if (Number.isFinite(duration)) {
			audioSource.stop(beginTime + duration + 0.02);
			setTimeout(() => this.playing.delete(playingItem), duration * 1000);
		}
	}
}
