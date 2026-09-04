const os = { tmpdir: () => '/tmp', networkInterfaces: () => ({}), homedir: () => '/', platform: () => 'browser' };
export default os;
export const { tmpdir, networkInterfaces, homedir, platform } = os;
