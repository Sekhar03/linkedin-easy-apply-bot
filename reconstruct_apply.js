const fs = require('fs');
const path = require('path');

const targetConvoId = '3732d0d3-d588-4778-9110-0eeced1b9bcb';
const logPath = `C:\\Users\\sekha\\.gemini\\antigravity\\brain\\${targetConvoId}\\.system_generated\\logs\\transcript_full.jsonl`;

function reconstruct() {
  try {
    if (!fs.existsSync(logPath)) {
      console.log('Log path does not exist:', logPath);
      return;
    }
    const lines = fs.readFileSync(logPath, 'utf8').split('\n');
    console.log(`Reconstructing apply.js from conversation ${targetConvoId}...`);
    
    let currentCode = '';
    let foundInitial = false;
    let editCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      
      try {
        const data = JSON.parse(line);
        if (!data.tool_calls) continue;
        
        for (const tc of data.tool_calls) {
          if (tc.args.TargetFile && tc.args.TargetFile.endsWith('apply.js')) {
            if (tc.name === 'write_to_file') {
              currentCode = tc.args.CodeContent;
              foundInitial = true;
              console.log(`Step ${data.step_index}: Initialized apply.js (${currentCode.length} chars)`);
            } else if (tc.name === 'replace_file_content' && foundInitial) {
              const target = tc.args.TargetContent;
              const replacement = tc.args.ReplacementContent;
              
              if (currentCode.includes(target)) {
                currentCode = currentCode.replace(target, replacement);
                editCount++;
                console.log(`Step ${data.step_index}: Applied replace_file_content edit #${editCount} (${tc.args.Description || 'no desc'})`);
              } else {
                console.warn(`Step ${data.step_index}: Target content not found for replace_file_content!`);
              }
            } else if (tc.name === 'multi_replace_file_content' && foundInitial) {
              const chunks = tc.args.ReplacementChunks;
              if (chunks) {
                // Sort chunks by line number descending if possible, or just apply them one by one if they are unique substrings
                for (const chunk of chunks) {
                  const target = chunk.TargetContent;
                  const replacement = chunk.ReplacementContent;
                  if (currentCode.includes(target)) {
                    currentCode = currentCode.replace(target, replacement);
                    editCount++;
                  } else {
                    console.warn(`Step ${data.step_index}: Target content not found for multi_replace_file_content chunk!`);
                  }
                }
                console.log(`Step ${data.step_index}: Applied multi_replace_file_content edits (${tc.args.Description || 'no desc'})`);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error parsing line:', err.message);
      }
    }
    
    if (foundInitial) {
      const outputPath = 'C:\\Users\\sekha\\.gemini\\antigravity\\brain\\5ef2a085-d647-4ed7-9e27-751946bc255b\\scratch\\reconstructed_apply_v1.js';
      fs.writeFileSync(outputPath, currentCode, 'utf8');
      console.log(`\nReconstruction finished! Applied ${editCount} edits.`);
      console.log(`Saved reconstructed file to ${outputPath} (${currentCode.length} chars)`);
    } else {
      console.log('Could not find initial write_to_file for apply.js');
    }
  } catch (e) {
    console.error(e);
  }
}

reconstruct();
