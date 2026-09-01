const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\sekha\\.gemini\\antigravity\\brain';

function search() {
  try {
    const folders = fs.readdirSync(brainDir);
    console.log(`Scanning folders...`);
    
    const results = [];
    
    for (const f of folders) {
      const folderPath = path.join(brainDir, f);
      const stats = fs.statSync(folderPath);
      if (!stats.isDirectory()) continue;
      
      const logPath = path.join(folderPath, '.system_generated', 'logs', 'transcript_full.jsonl');
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf8');
        const lines = content.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.tool_calls) {
              for (const tc of data.tool_calls) {
                if ((tc.name === 'write_to_file' || tc.name === 'replace_file_content' || tc.name === 'multi_replace_file_content') && 
                    tc.args.TargetFile && tc.args.TargetFile.endsWith('apply.js')) {
                  results.push({
                    convoId: f,
                    date: new Date(data.created_at || stats.birthtime),
                    toolName: tc.name,
                    target: tc.args.TargetFile,
                    args: tc.args,
                    step: data.step_index
                  });
                }
              }
            }
          } catch (err) {}
        }
      }
    }
    
    // Sort results by date descending (latest first)
    results.sort((a, b) => b.date - a.date);
    
    console.log(`Found ${results.length} total tool calls targeting apply.js across history.`);
    console.log('List of historical tool calls (latest to oldest):');
    for (let i = 0; i < Math.min(40, results.length); i++) {
      const r = results[i];
      console.log(`${i + 1}. Convo: ${r.convoId} | Step: ${r.step} | Tool: ${r.toolName} | Date: ${r.date.toISOString()}`);
    }
    
    // Let's print the details of the changes in conversation 3732d0d3-d588-4778-9110-0eeced1b9bcb
    console.log('\n--- Tool calls in conversation 3732d0d3-d588-4778-9110-0eeced1b9bcb ---');
    const convoEdits = results.filter(r => r.convoId === '3732d0d3-d588-4778-9110-0eeced1b9bcb');
    convoEdits.sort((a, b) => a.step - b.step);
    for (const e of convoEdits) {
      console.log(`Step ${e.step} (${e.toolName}): Description: ${e.args.Description || e.args.Instruction || 'none'}`);
    }
    
  } catch (e) {
    console.error(e);
  }
}

search();
