const fs = require('fs');
const path = require('path');

const targetConvoId = '5ef2a085-d647-4ed7-9e27-751946bc255b';
const logPath = `C:\\Users\\sekha\\.gemini\\antigravity\\brain\\${targetConvoId}\\.system_generated\\logs\\transcript_full.jsonl`;
const baseCodePath = 'C:\\Users\\sekha\\.gemini\\antigravity\\brain\\5ef2a085-d647-4ed7-9e27-751946bc255b\\scratch\\reconstructed_apply_v1.js';

function reconstruct() {
  try {
    if (!fs.existsSync(logPath)) {
      console.log('Log path does not exist:', logPath);
      return;
    }
    if (!fs.existsSync(baseCodePath)) {
      console.log('Base code path does not exist:', baseCodePath);
      return;
    }
    
    let currentCode = fs.readFileSync(baseCodePath, 'utf8');
    const lines = fs.readFileSync(logPath, 'utf8').split('\n');
    console.log(`Reconstructing apply.js from current conversation ${targetConvoId} edits...`);
    
    let editCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      
      try {
        const data = JSON.parse(line);
        // We only want edits BEFORE the user asked to revert (Step 223)
        if (data.step_index >= 223) continue;
        if (!data.tool_calls) continue;
        
        for (const tc of data.tool_calls) {
          if (tc.args.TargetFile && tc.args.TargetFile.endsWith('apply.js')) {
            if (tc.name === 'replace_file_content') {
              const target = tc.args.TargetContent;
              const replacement = tc.args.ReplacementContent;
              
              if (currentCode.includes(target)) {
                currentCode = currentCode.replace(target, replacement);
                editCount++;
                console.log(`Step ${data.step_index}: Applied replace_file_content edit #${editCount} (${tc.args.Description || 'no desc'})`);
              } else {
                console.warn(`Step ${data.step_index}: Target content not found for replace_file_content!`);
              }
            } else if (tc.name === 'multi_replace_file_content') {
              const chunks = tc.args.ReplacementChunks;
              if (chunks) {
                let chunksApplied = 0;
                for (const chunk of chunks) {
                  const target = chunk.TargetContent;
                  const replacement = chunk.ReplacementContent;
                  if (currentCode.includes(target)) {
                    currentCode = currentCode.replace(target, replacement);
                    editCount++;
                    chunksApplied++;
                  } else {
                    console.warn(`Step ${data.step_index}: Target content not found for multi_replace_file_content chunk!`);
                  }
                }
                console.log(`Step ${data.step_index}: Applied multi_replace_file_content (${chunksApplied}/${chunks.length} chunks) (${tc.args.Description || 'no desc'})`);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error parsing line:', err.message);
      }
    }
    
    const outputPath = 'C:\\Users\\sekha\\.gemini\\antigravity\\brain\\5ef2a085-d647-4ed7-9e27-751946bc255b\\scratch\\final_working_apply.js';
    fs.writeFileSync(outputPath, currentCode, 'utf8');
    console.log(`\nReconstruction finished! Applied ${editCount} edits.`);
    console.log(`Saved reconstructed file to ${outputPath} (${currentCode.length} chars)`);
  } catch (e) {
    console.error(e);
  }
}

reconstruct();
