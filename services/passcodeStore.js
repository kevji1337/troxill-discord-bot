const passcodes = new Map(); // code => { user, expiresAt }

function createPasscode(user) {
    // Generate random 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    passcodes.set(code, { user, expiresAt });
    return code;
}

function verifyPasscode(code) {
    const cleanCode = String(code || '').trim();
    const entry = passcodes.get(cleanCode);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
        passcodes.delete(cleanCode);
        return null;
    }

    passcodes.delete(cleanCode);
    return entry.user;
}

module.exports = { createPasscode, verifyPasscode };
