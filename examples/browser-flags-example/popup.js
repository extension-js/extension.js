// Popup script for the Browser Flags Example

document.addEventListener('DOMContentLoaded', function() {
  // Get elements
  const playAudioBtn = document.getElementById('playAudio');
  const audioElement = document.getElementById('testAudio');
  
  // Create a short beep sound (since the placeholder in HTML won't work)
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  
  // Play sound when button is clicked
  playAudioBtn.addEventListener('click', function() {
    // Try multiple methods to play audio for compatibility
    
    // Method 1: Using the audio element
    audioElement.play().catch(err => {
      console.log('Audio element play failed:', err);
      
      // Method 2: Using Web Audio API as fallback
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.type = 'sine';
      oscillator.frequency.value = 440; // A4 note
      gainNode.gain.value = 0.5;
      
      oscillator.start();
      setTimeout(() => {
        oscillator.stop();
        console.log('Played sound using Web Audio API');
      }, 200);
    });
    
    // Show status message
    const statusMessage = document.createElement('div');
    statusMessage.textContent = 'Audio played - if you hear a sound, the --mute-audio flag was successfully disabled!';
    statusMessage.style.color = '#4CAF50';
    statusMessage.style.marginTop = '10px';
    playAudioBtn.parentNode.appendChild(statusMessage);
    
    // Remove the status message after 3 seconds
    setTimeout(() => {
      statusMessage.remove();
    }, 3000);
  });
  
  // Add a visible message about scrollbars
  const scrollableDiv = document.querySelector('.scrollable');
  const scrollStatus = document.createElement('div');
  scrollStatus.textContent = scrollableDiv.scrollHeight > scrollableDiv.clientHeight ? 
    'Scrollbars are visible - the --hide-scrollbars flag was successfully disabled!' : 
    'Content is not tall enough to show scrollbars.';
  scrollStatus.style.color = '#4CAF50';
  scrollStatus.style.marginTop = '10px';
  scrollableDiv.parentNode.appendChild(scrollStatus);
});
