//! 本地加密 token 存储。
//!
//! ## 为什么不是上游那套
//! 旧实现用 `HKDF(硬编码在二进制里的主密钥, salt = SHA-256("用户名@主机名"))`
//! 派生 AES-256-GCM 密钥。主密钥随安装包公开分发，salt 的两个输入一个写在 vault 的路径里、
//! 一个本机可探测——任何拿到 `tokens.vault` 的人都能离线还原密钥并解密。那是混淆，不是加密。
//!
//! ## More 的方案与它的真实边界
//! 首次存凭证时用 CSPRNG 生成 32 字节随机密钥，存为数据目录下的 `.vault-key`（0600，仅当前
//! 用户可读写）。它不进入安装包、不跨机器，所以「拿别人的安装包 + 自己的 vault」不再能解密。
//!
//! 刻意**不用系统钥匙串**：本工具是 ad-hoc 签名（无 Apple Developer ID），macOS 的钥匙串 ACL
//! 绑定二进制的签名身份，每次重新编译身份就变，于是每次升级都会弹「某程序想使用钥匙串中的机密
//! 信息，请输入登录钥匙串密码」。实测该弹窗会让进程一直阻塞在弹窗上；用户点「拒绝」还会导致
//! 整库解不开。对一个要发给朋友的免签名小工具，这个代价大于收益。
//!
//! 因此请如实理解保护范围：
//! - 挡得住：安装包公开传播导致的「人人可解密」、同机其它普通用户的读取；
//! - 挡不住：root 权限、以你身份运行的任意进程、以及把整个数据目录一起备份/同步出去的泄露。
//! 需要更强保护就给数据目录所在磁盘开 FileVault，并且别把它放进云同步目录。
//!
//! 存储格式：[12B nonce][ciphertext + 16B GCM tag]

use std::collections::HashMap;
use std::path::PathBuf;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;

use crate::error::{WmError, WmResult};
use crate::platform::more_paths;
use crate::wbauth::AuthTokens;

const FILE_KEY_NAME: &str = ".vault-key";
/// HKDF 域分离信息（非机密，只用于把这把密钥限定到「vault 加密」这一个用途）。
const HKDF_INFO: &[u8] = b"more-vault-v2";

fn vault_path() -> PathBuf {
    more_paths().root.join("tokens.vault")
}

fn keyfile_path() -> PathBuf {
    more_paths().root.join(FILE_KEY_NAME)
}

fn decode_key(hex_key: &str) -> Option<[u8; 32]> {
    let raw = hex::decode(hex_key).ok()?;
    if raw.len() != 32 {
        return None;
    }
    let mut k = [0u8; 32];
    k.copy_from_slice(&raw);
    Some(k)
}

/// 取得（必要时创建）本机主密钥。首次随机生成，之后固定复用。
fn master_key() -> WmResult<[u8; 32]> {
    let path = keyfile_path();
    if let Ok(existing) = std::fs::read_to_string(&path) {
        if let Some(k) = decode_key(existing.trim()) {
            return Ok(k);
        }
        return Err(WmError::Crypto("本机主密钥文件内容异常，请重新授权".into()));
    }
    let mut raw = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&path, hex::encode(raw))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    tracing::info!("已生成本机随机主密钥：{}", path.display());
    Ok(raw)
}

/// 派生 vault 加密密钥：HKDF-SHA256(ikm=主密钥, info=域分离常量)。
fn derive_key() -> WmResult<[u8; 32]> {
    let ikm = master_key()?;
    let hk = Hkdf::<Sha256>::new(None, &ikm);
    let mut okm = [0u8; 32];
    hk.expand(HKDF_INFO, &mut okm)
        .map_err(|_| WmError::Crypto("HKDF expand 失败".into()))?;
    Ok(okm)
}

/// 主密钥状态，供界面展示：file = 已生成本机随机密钥；not-created = 还没存过凭证。
pub fn key_source() -> String {
    if keyfile_path().exists() {
        "file".to_string()
    } else {
        "not-created".to_string()
    }
}

/// 加载全部 token。解密失败（换机器 / 密钥文件被删）返回空表，上层据此提示重新授权。
fn load_all() -> HashMap<String, String> {
    let data = match std::fs::read(vault_path()) {
        Ok(d) => d,
        Err(_) => return HashMap::new(),
    };
    if data.len() < 12 {
        return HashMap::new();
    }
    let (nonce_bytes, ciphertext) = data.split_at(12);
    let key = match derive_key() {
        Ok(k) => k,
        Err(e) => {
            tracing::error!("无法取得 vault 主密钥：{e}");
            return HashMap::new();
        }
    };
    let cipher = match Aes256Gcm::new_from_slice(&key) {
        Ok(c) => c,
        Err(_) => return HashMap::new(),
    };
    match cipher.decrypt(Nonce::from_slice(nonce_bytes), ciphertext) {
        Ok(pt) => serde_json::from_slice(&pt).unwrap_or_default(),
        Err(_) => {
            tracing::warn!("token vault 解密失败（主密钥文件已变更或跨机使用），需重新授权");
            HashMap::new()
        }
    }
}

/// 加密写入全部 token。
fn save_all(map: &HashMap<String, String>) -> WmResult<()> {
    let mut plaintext = serde_json::to_vec(map)?;
    let key = derive_key()?;
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| WmError::Crypto("AES 密钥长度异常".into()))?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_ref())
        .map_err(|_| WmError::Crypto("AES 加密失败".into()))?;
    // 明文缓冲尽早覆盖（强度主要来自密钥本身，这里只是少留一份）。
    for b in plaintext.iter_mut() {
        *b = 0;
    }
    let mut data = Vec::with_capacity(12 + ciphertext.len());
    data.extend_from_slice(&nonce_bytes);
    data.extend_from_slice(&ciphertext);
    let path = vault_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&path, data)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// 存储单个账号的 token。
pub fn store_token(uid: &str, tokens: &AuthTokens) -> WmResult<()> {
    let json = serde_json::to_string(tokens)?;
    let mut map = load_all();
    map.insert(uid.to_string(), json);
    save_all(&map)
}

/// 读取单个账号的 token。
pub fn load_token(uid: &str) -> Option<AuthTokens> {
    let map = load_all();
    let json = map.get(uid)?;
    serde_json::from_str(json).ok()
}

/// 删除单个账号的 token。
pub fn delete_token(uid: &str) -> WmResult<()> {
    let mut map = load_all();
    map.remove(uid);
    save_all(&map)
}

/// 清空整库 token（设置页「抹掉本机凭证」）。
pub fn purge_all() -> WmResult<()> {
    let path = vault_path();
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    tracing::info!("已清空 token vault");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard, OnceLock};

    /// 这些测试共用同一个数据目录里的 `.vault-key` 与 `tokens.vault`，
    /// 其中「换密钥」一条会临时替换密钥文件——必须串行，否则并行时互相写坏。
    fn vault_lock() -> MutexGuard<'static, ()> {
        static L: OnceLock<Mutex<()>> = OnceLock::new();
        L.get_or_init(|| Mutex::new(())).lock().unwrap_or_else(|e| e.into_inner())
    }

    fn tokens(access: &str) -> AuthTokens {
        AuthTokens {
            access_token: access.to_string(),
            refresh_token: "refresh-secret".to_string(),
            token_type: "Bearer".to_string(),
            expires_at: None,
            refresh_expires_at: None,
            scope: String::new(),
            domain: String::new(),
            uid: String::new(),
        }
    }

    #[test]
    fn 生产代码里不得残留硬编码主密钥() {
        let _serial = vault_lock();
        // 只扫描 #[cfg(test)] 之前的生产代码，避免被本测试自己的字面量误伤。
        let src = include_str!("vault.rs");
        let prod = src.split("#[cfg(test)]").next().unwrap_or("");
        for banned in [
            "旧实现2026",
            "MASTER_SECRET",
            "token_vault_master",
            "fallback-master-key",
        ] {
            assert!(!prod.contains(banned), "残留硬编码主密钥线索：{banned}");
        }
    }

    #[test]
    fn 主密钥是本机随机值且权限受限且稳定() {
        let _serial = vault_lock();
        let k = master_key().expect("应能取得主密钥");
        assert_eq!(k.len(), 32);
        assert_ne!(k, [0u8; 32], "主密钥不应为全零占位");
        assert_eq!(
            k,
            master_key().expect("再次读取应一致"),
            "主密钥必须稳定，否则刷新一次凭证就全解不开"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(keyfile_path())
                .expect("密钥文件应存在")
                .permissions()
                .mode();
            assert_eq!(
                mode & 0o077,
                0,
                "密钥文件不得对同组/其它用户开放，实际 {mode:o}"
            );
        }
    }

    #[test]
    fn token_加解密往返正常() {
        let _serial = vault_lock();
        let uid = "more-unit-test-uid";
        store_token(uid, &tokens("access-abc-123")).expect("写入 vault 应成功");
        let back = load_token(uid).expect("应能读回 token");
        assert_eq!(back.access_token, "access-abc-123");
        assert_eq!(back.refresh_token, "refresh-secret");
        delete_token(uid).expect("删除应成功");
        assert!(load_token(uid).is_none(), "删除后不应再读得到");
    }

    #[test]
    fn 落盘内容不含明文凭证() {
        let _serial = vault_lock();
        let uid = "more-unit-cipher-uid";
        store_token(uid, &tokens("PLAINTEXT-MARKER-XYZ")).expect("写入应成功");
        let raw = std::fs::read(vault_path()).expect("vault 文件应存在");
        let as_text = String::from_utf8_lossy(&raw);
        assert!(!as_text.contains("PLAINTEXT-MARKER-XYZ"), "密文里不得出现 access_token 明文");
        assert!(!as_text.contains("refresh-secret"), "密文里不得出现 refresh_token 明文");
        delete_token(uid).ok();
    }

    #[test]
    fn 换密钥后旧库解不开而不是吐出明文() {
        let _serial = vault_lock();
        let uid = "more-unit-rotate-uid";
        store_token(uid, &tokens("rotate-marker")).expect("写入应成功");
        let key_path = keyfile_path();
        let backup = std::fs::read(&key_path).expect("密钥文件应存在");
        let mut fresh = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut fresh);
        std::fs::write(&key_path, hex::encode(fresh)).expect("写入新密钥应成功");
        assert!(load_token(uid).is_none(), "换密钥后不应再解得开旧库");
        std::fs::write(&key_path, backup).expect("恢复密钥应成功");
        assert_eq!(
            load_token(uid).map(|t| t.access_token).as_deref(),
            Some("rotate-marker"),
            "密钥复原后应重新可读"
        );
        delete_token(uid).ok();
    }
}
