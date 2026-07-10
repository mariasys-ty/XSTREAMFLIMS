/**
 * FP.js - Forgot Password Module
 * Uses EmailJS to send password reset emails
 * Connects to js/app.js for Firebase Realtime Database
 */

// Prevent duplicate loading
if (typeof ForgotPassword !== 'undefined') {
    console.log('[FP.js] Already loaded, skipping...');
} else {

var ForgotPassword = (function() {
    
    // ============================================
    // CONFIGURATION - Reads from global ENV_CONFIG
    // ============================================
    const config = {
        emailjs: {
            serviceId: (typeof ENV_CONFIG !== 'undefined') ? ENV_CONFIG.EMAILJS_FORGOT_SERVICE_ID : '',
            templateId: (typeof ENV_CONFIG !== 'undefined') ? ENV_CONFIG.EMAILJS_FORGOT_TEMPLATE_ID : '',
            publicKey: (typeof ENV_CONFIG !== 'undefined') ? ENV_CONFIG.EMAILJS_PUBLIC_KEY : ''
        },
        token: {
            expirationHours: 1,
            length: 64
        },
        pages: {
            resetPasswordUrl: 'XSTREAM/reset-password.html' // Removed leading slash for local file compatibility
        },
        firebase: {
            resetsCollection: 'passwordResets'
        },
        debug: true
    };

    // ============================================
    // DEBUG LOGGER
    // ============================================
    function log() {
        if (config.debug) {
            console.log('%c[FP.js]', 'color: #e63946; font-weight: bold;', ...arguments);
        }
    }

    function logError() {
        console.error('%c[FP.js ERROR]', 'color: #ef4444; font-weight: bold;', ...arguments);
    }

    // ============================================
    // CORE METHODS
    // ============================================

    function initEmailJS() {
        if (typeof emailjs === 'undefined') {
            logError('EmailJS SDK not loaded!');
            return false;
        }
        if (!config.emailjs.publicKey || !config.emailjs.serviceId || !config.emailjs.templateId) {
            logError('EmailJS config missing in ENV_CONFIG!');
            return false;
        }
        try {
            emailjs.init(config.emailjs.publicKey);
            log('EmailJS initialized');
            return true;
        } catch (e) {
            logError('EmailJS init failed:', e.message);
            return false;
        }
    }

    // Changed from Firestore to Realtime Database to match your app.js
    function getDb() {
        if (typeof firebase === 'undefined' || !firebase.database) {
            throw new Error('Firebase Realtime Database not initialized.');
        }
        return firebase.database();
    }

    function generateToken() {
        var bytes = new Uint8Array(config.token.length);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    }

    async function storeToken(email, token) {
        var db = getDb();
        var expiresAt = Date.now() + (config.token.expirationHours * 60 * 60 * 1000);
        
        log('Storing token for:', email);
        
        await db.ref(config.firebase.resetsCollection + '/' + token).set({
            email: email,
            token: token,
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            expiresAt: expiresAt,
            used: false
        });
        
        log('Token stored in Realtime DB');
        return { token: token, expiresAt: expiresAt };
    }

    async function verifyToken(token) {
        if (!token) {
            return { valid: false, error: 'No token provided' };
        }

        log('Verifying token...');

        var db = getDb();
        var snapshot = await db.ref(config.firebase.resetsCollection + '/' + token).once('value');

        if (!snapshot.exists()) {
            return { valid: false, error: 'Invalid reset link' };
        }

        var data = snapshot.val();

        if (data.used) {
            return { valid: false, error: 'This link has already been used' };
        }

        if (Date.now() > data.expiresAt) {
            return { valid: false, error: 'This link has expired' };
        }

        log('Token valid for:', data.email);
        return { valid: true, email: data.email };
    }

    async function invalidateToken(token) {
        var db = getDb();
        await db.ref(config.firebase.resetsCollection + '/' + token).update({
            used: true,
            usedAt: firebase.database.ServerValue.TIMESTAMP
        });
    }

    async function sendResetEmail(email, resetLink) {
        var templateParams = {
            to_email: email,       // Make sure this matches your EmailJS template exactly!
            to_name: email.split('@')[0],
            reset_link: resetLink, // Make sure this matches your EmailJS template exactly!
            expiry_hours: String(config.token.expirationHours),
            site_name: window.location.hostname || 'xStream Movies',
            current_year: String(new Date().getFullYear())
        };

        log('=== SENDING EMAIL ===');
        log('To:', email);
        log('Link:', resetLink);
        log('====================');

        var response = await emailjs.send(
            config.emailjs.serviceId,
            config.emailjs.templateId,
            templateParams
        );

        log('✓ Email sent! Status:', response.status);
        return response;
    }

    // Keeps your Cloud Function logic (assuming you have this deployed)
    async function updatePasswordViaCloudFunction(token, newPassword) {
        var response = await fetch('https://YOUR_REGION-YOUR_PROJECT_ID.cloudfunctions.net/resetPassword', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token, newPassword: newPassword })
        });

        var result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Failed to update password');
        }

        return result;
    }

    // ============================================
    // UI HELPERS
    // ============================================

    function showError(fieldId, message) {
        var errorEl = document.getElementById(fieldId + '-error');
        var field = document.getElementById(fieldId);
        
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
            errorEl.classList.add('visible');
        }
        if (field) {
            field.classList.add('input-error');
        }
    }

    function clearErrors(formPrefix) {
        document.querySelectorAll('.form-error').forEach(function(el) {
            el.textContent = '';
            el.style.display = 'none';
            el.classList.remove('visible');
        });
        document.querySelectorAll('.input-error').forEach(function(el) {
            el.classList.remove('input-error');
        });
    }

    function setLoading(formId, isLoading) {
        var submitBtn = document.getElementById(formId + '-submit');
        
        if (!submitBtn) {
            var form = document.getElementById(formId + '-form') || document.getElementById('reset-form');
            if (form) submitBtn = form.querySelector('button[type="submit"]');
        }
        
        if (!submitBtn) return;

        submitBtn.disabled = isLoading;
        var btnText = submitBtn.querySelector('.btn-text');
        
        if (btnText) {
            if (isLoading) {
                if (!submitBtn.dataset.originalText) {
                    submitBtn.dataset.originalText = btnText.textContent;
                }
                btnText.innerHTML = '<span class="spinner"></span> Processing...';
            } else {
                btnText.textContent = submitBtn.dataset.originalText || 'Submit';
            }
        }
    }

    function showToast(message, type) {
        type = type || 'info';
        
        var container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:10000;display:flex;flex-direction:column;gap:10px;';
            document.body.appendChild(container);
        }

        var icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
        var colors = { 
            success: '#22c55e', 
            error: '#ef4444', 
            info: '#3b82f6',
            warning: '#f59e0b'
        };

        var toast = document.createElement('div');
        toast.style.cssText = 'padding:14px 20px;border-radius:12px;color:white;font-size:14px;font-family:sans-serif;max-width:380px;box-shadow:0 10px 40px rgba(0,0,0,0.4);display:flex;align-items:center;gap:10px;background:' + (colors[type] || colors.info);
        toast.innerHTML = '<span style="font-weight:700;font-size:16px;">' + (icons[type] || '') + '</span> <span>' + message + '</span>';
        
        container.appendChild(toast);

        setTimeout(function() {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(function() {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, 5000);
    }

    // ============================================
    // EVENT HANDLERS
    // ============================================

    async function handleForgotSubmit(e) {
        e.preventDefault();
        clearErrors('forgot');

        var emailInput = document.getElementById('forgot-email');
        var email = emailInput ? emailInput.value.trim() : '';

        log('=== FORGOT PASSWORD ===');
        log('Email:', email);

        if (!email) {
            showError('forgot-email', 'Email is required');
            return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showError('forgot-email', 'Please enter a valid email address');
            return;
        }

        setLoading('forgot', true);

        try {
            if (!initEmailJS()) {
                throw new Error('Email service is not configured properly.');
            }

            var token = generateToken();
            log('Token:', token.substring(0, 15) + '...');

            await storeToken(email, token);

            var resetUrl = window.location.origin + '/' + config.pages.resetPasswordUrl + '?token=' + token;
            log('URL:', resetUrl);

            await sendResetEmail(email, resetUrl);

            log('=== SUCCESS ===');
            setLoading('forgot', false);
            showToast('Password reset email sent! Check your inbox (and spam folder).', 'success');

            var modal = document.getElementById('forgot-modal');
            if (modal) modal.style.display = 'none';
            if (emailInput) emailInput.value = '';

        } catch (error) {
            setLoading('forgot', false);
            logError('FAILED:', error.message, error.status, error.text);
            
            var msg = 'Failed to send email. ';
            if (error.status === 400) msg += 'Check template variables.';
            else if (error.status === 403) msg += 'Check EmailJS keys.';
            else if (error.text) msg += error.text;
            else msg += error.message || 'Try again.';
            
            showToast(msg, 'error');
        }
    }

    async function handleResetSubmit(e) {
        e.preventDefault();
        clearErrors('reset');

        var passwordInput = document.getElementById('new-password');
        var confirmInput = document.getElementById('confirm-password');
        var password = passwordInput ? passwordInput.value : '';
        var confirmPassword = confirmInput ? confirmInput.value : '';
        var urlParams = new URLSearchParams(window.location.search);
        var token = urlParams.get('token');

        if (!token) {
            showToast('Invalid reset link', 'error');
            return;
        }

        if (!password || password.length < 6) {
            showError('new-password', 'Password must be at least 6 characters');
            return;
        }

        if (password !== confirmPassword) {
            showError('confirm-password', 'Passwords do not match');
            return;
        }

        setLoading('reset', true);

        try {
            var verification = await verifyToken(token);
            
            if (!verification.valid) {
                showToast(verification.error, 'error');
                setLoading('reset', false);
                return;
            }

            await updatePasswordViaCloudFunction(token, password);
            await invalidateToken(token);

            setLoading('reset', false);
            showToast('Password reset! Redirecting...', 'success');

            if (passwordInput) passwordInput.value = '';
            if (confirmInput) confirmInput.value = '';

            setTimeout(function() {
                window.location.href = window.location.origin + '/login.html';
            }, 2000);

        } catch (error) {
            setLoading('reset', false);
            logError('Reset failed:', error);
            showToast(error.message || 'Failed to reset password', 'error');
        }
    }

    function initModalEvents() {
        var forgotBtn = document.getElementById('forgot-password-btn');
        var forgotModal = document.getElementById('forgot-modal');
        var closeBtn = document.getElementById('close-forgot-modal');

        if (forgotBtn && forgotModal) {
            forgotBtn.addEventListener('click', function() {
                forgotModal.style.display = 'flex';
                setTimeout(function() {
                    var input = document.getElementById('forgot-email');
                    if (input) input.focus();
                }, 100);
            });
        }

        if (closeBtn && forgotModal) {
            closeBtn.addEventListener('click', function() {
                forgotModal.style.display = 'none';
            });
        }

        if (forgotModal) {
            forgotModal.addEventListener('click', function(e) {
                if (e.target === forgotModal) {
                    forgotModal.style.display = 'none';
                }
            });
        }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && forgotModal && forgotModal.style.display === 'flex') {
                forgotModal.style.display = 'none';
            }
        });
    }

    // ============================================
    // PUBLIC API
    // ============================================

    return {
        init: function(options) {
            options = options || {};
            if (options.emailjs) Object.assign(config.emailjs, options.emailjs);
            if (options.pages) Object.assign(config.pages, options.pages);
            if (options.firebase) Object.assign(config.firebase, options.firebase);
            if (options.debug !== undefined) config.debug = options.debug;

            log('Initializing...');
            initEmailJS();
            initModalEvents();

            var form = document.getElementById('forgot-form');
            if (form) {
                form.addEventListener('submit', handleForgotSubmit);
                log('Form handler attached');
            }

            log('Ready!');
        },

        initResetPage: function(options) {
            options = options || {};
            if (options.emailjs) Object.assign(config.emailjs, options.emailjs);
            if (options.firebase) Object.assign(config.firebase, options.firebase);
            if (options.debug !== undefined) config.debug = options.debug;

            log('Init reset page...');
            initEmailJS();

            var urlParams = new URLSearchParams(window.location.search);
            var token = urlParams.get('token');

            if (token) {
                this.verifyTokenOnLoad(token);
            } else {
                this.showTokenError('Invalid or missing reset link');
            }

            var form = document.getElementById('reset-form');
            if (form) form.addEventListener('submit', handleResetSubmit);

            log('Reset page ready');
        },

        verifyTokenOnLoad: async function(token) {
            var statusEl = document.getElementById('reset-status');
            var formEl = document.getElementById('reset-form');
            var emailEl = document.getElementById('reset-email-display');

            try {
                var result = await verifyToken(token);
                
                if (!result.valid) {
                    this.showTokenError(result.error);
                    return;
                }

                if (emailEl) {
                    var parts = result.email.split('@');
                    emailEl.textContent = parts[0].slice(0, 2) + '***@' + parts[1];
                }

                if (statusEl) {
                    statusEl.innerHTML = '<span style="color: #22c55e;">✓ Valid reset link</span>';
                }
            } catch (error) {
                this.showTokenError('Failed to verify reset link');
            }
        },

        showTokenError: function(message) {
            var statusEl = document.getElementById('reset-status');
            var formEl = document.getElementById('reset-form');

            if (statusEl) {
                statusEl.innerHTML = '<span style="color: #ef4444;">✗ ' + message + '</span><br><a href="/login.html" style="color: #e63946; text-decoration: none; display: inline-block; margin-top: 12px; padding: 8px 20px; background: rgba(230,57,70,0.1); border-radius: 8px;">Back to Login</a>';
            }
            if (formEl) formEl.style.display = 'none';
        },

        getConfig: function() {
            return {
                serviceId: config.emailjs.serviceId,
                templateId: config.emailjs.templateId,
                hasKey: !!config.emailjs.publicKey
            };
        }
    };
})();

} // End of duplicate check