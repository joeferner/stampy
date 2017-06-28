import * as fs from "fs-extra";
import * as path from "path";
import * as tmp from "tmp";
import {run} from "../src/stampy-run";
import * as nodeunit from "nodeunit";

interface Expected {
    error?: boolean;
    lines?: string[];
}

module.exports = {};

const dir = fs.readdirSync('tests');
for (let f of dir) {
    if (f.startsWith('.')) {
        continue;
    }
    const fname = path.join('tests', f);
    const stat = fs.statSync(fname);
    if (stat.isDirectory()) {
        module.exports[f] = function (test: nodeunit.Test) {
            const stampyConfig = path.join(fname, 'stampy.yaml');
            const expectedFile = path.join(fname, 'expected.json');
            const expected: Expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
            tmp.file((err, tempFileName, fd, cleanupCallback) => {
                if (err) {
                    return test.done(err);
                }

                const args = [
                    process.argv[0],
                    process.argv[1],
                    '--config', stampyConfig,
                    '--outputFormat', 'json',
                    '--output', tempFileName
                ];
                console.log('**************************************************************************************');
                console.log(`running ${args.join(' ')}`);
                run(args)
                    .then(() => {
                        if (expected.error) {
                            cleanupCallback();
                            return test.done(new Error('expected error'));
                        }

                        const results = fs.readFileSync(tempFileName, 'utf8')
                            .trim()
                            .split('\n')
                            .map(line => {
                                return JSON.parse(line);
                            });
                        console.log(`results for ${f}`);
                        console.log(results.map(line => {
                            if (line.action === 'COPY') {
                                delete line['data'];
                            }
                            return JSON.stringify(line);
                        }).join(',\n'));
                        test.equals(results.length, expected.lines.length, `expected lines (${expected.lines.length}) did not match found lines (${results.length})`);
                        for (let i = 0; i < results.length; i++) {
                            const foundLine = results[i];
                            const expectedLine = expected.lines[i];
                            if (foundLine.action === 'COPY') {
                                delete foundLine['data'];
                            }
                            if (foundLine.action === 'COPY') {
                                delete foundLine['data'];
                            }
                            test.equals(JSON.stringify(foundLine), JSON.stringify(expectedLine));
                        }

                        cleanupCallback();
                        test.done();
                    })
                    .catch(err => {
                        cleanupCallback();
                        if (expected.error) {
                            console.log(err);
                            return test.done();
                        }
                        test.done(err);
                    });
            });
        }
    }
}