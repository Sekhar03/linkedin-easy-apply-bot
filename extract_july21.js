const fs = require('fs');
const path = require('path');

const targetConvoId = '293ef324-1ec0-46cb-8ba3-9da1fa2e8655';
const logPath = `C:\\Users\\sekha\\.gemini\\antigravity\\brain\\${targetConvoId}\\.system_generated\\logs\\transcript_full.jsonl`;

function extract() {
  try {
    if (!fs.existsSync(logPath)) {
      console.log('Log path does not exist:', logPath);
      return;
    }
    const lines = fs.readFileSync(logPath, 'utf8').split('\n');
    console.log(`Analyzing ${lines.length} lines in log of ${targetConvoId}...`);
    
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.trim()) continue;
      
      try {
        const data = JSON.parse(line);
        
        // Check if this was a VIEW_FILE tool call response for apply.js specifically
        if (data.type === 'VIEW_FILE' && data.content && data.content.includes('apply.js') && data.content.includes('const { chromium }')) {
          // Verify if it contains target file path for apply.js
          const matchPath = data.content.match(/File Path: `file:\/\/.*apply\.js`/);
          if (matchPath) {
            console.log(`Found complete apply.js content in VIEW_FILE output at step ${data.step_index}`);
            // Extract the actual file content from the VIEW_FILE output
            // VIEW_FILE output contains line-prefixed code, e.g. "1: const { chromium } = require..."
            // We need to parse and remove the line number prefixes!
            const rawContent = data.content;
            const contentLines = rawContent.split('\n');
            const parsedLines = [];
            for (const cl of contentLines) {
              const m = cl.match(/^\d+:\s(.*)/);
              if (m) {
                parsedLines.push(m[1]);
              }
            }
            if (parsedLines.length > 0) {
              fs.writeFileSync('C:\\Users\\sekha\\.gemini\\antigravity\\brain\\5ef2a085-d647-4ed7-9e27-751946bc255b\\scratch\\reverted_apply_July21.js', parsedLines.join('\n'), 'utf8');
              console.log('Saved parsed apply.js code to scratch/reverted_apply_July21.js');
              return;
            }
          }
        }
        
        // Also check if it was written via write_to_file targeting apply.js
        if (data.tool_calls) {
          for (const tc of data.tool_calls) {
            if (tc.name === 'write_to_file' && tc.args.TargetFile && tc.args.TargetFile.endsWith('apply.js')) {
              console.log(`Found complete apply.js content in write_to_file at step ${data.step_index}`);
              fs.writeFileSync('C:\\Users\\sekha\\.gemini\\antigravity\\brain\\5ef2a085-d647-4ed7-9e27-751946bc255b\\scratch\\reverted_apply_July21.js', tc.args.CodeContent, 'utf8');
              console.log('Saved write_to_file apply.js code to scratch/reverted_apply_July21.js');
              return;
            }
          }
        }
      } catch (err) {}
    }
    console.log('Could not find complete apply.js content in July 21 conversation.');
  } catch (e) {
    console.error(e);
  }
}

extract();
