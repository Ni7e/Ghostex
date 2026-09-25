use crate::app::window::account_usage::AccountUsagePanel;
use crate::*;
use serde_json::{Value, json};
use std::time::Duration;

impl GhostexGpuiApp {
    /// Claims the reset the user confirmed in an account's usage panel on the gxserver that owns the account, then refreshes every account button and hands the result back to the panel.
    pub(crate) fn redeem_account_reset(
        &mut self,
        titlebar_key: &str,
        credit_id: String,
        request_id: String,
        panel: gpui::WeakEntity<AccountUsagePanel>,
        cx: &mut gpui::Context<Self>,
    ) {
        let account = self
            .titlebar_accounts
            .iter()
            .find(|a| a["titlebarKey"] == titlebar_key && a["registered"] == true)
            .cloned()
            .unwrap_or(Value::Null);
        let machine = account["titlebarMachine"]
            .as_str()
            .unwrap_or("local")
            .to_string();
        let target = if machine == "local" {
            Ok(None)
        } else {
            self.remote_gxserver_connections
                .get(&machine)
                .map(|connection| Some(connection.request_target()))
                .ok_or("That computer is no longer connected.")
        };
        let request = match (account["id"].as_str(), target) {
            (Some(id), Ok(target)) => Ok((
                target,
                json!({"operation":"redeemReset","id":id,"creditId":credit_id,"requestId":request_id}),
            )),
            (None, _) => Err("This account is no longer available.".to_string()),
            (_, Err(error)) => Err(error.to_string()),
        };
        cx.spawn(async move |this, cx| {
            let result = match request {
                Ok((target, params)) => {
                    cx.background_executor()
                        .spawn(async move {
                            let timeout = Duration::from_secs(90);
                            match target {
                                Some(target) => gpui_remote_gxserver_rpc_result(
                                    &target,
                                    "/api/agentAccounts",
                                    &params,
                                    timeout,
                                ),
                                None => {
                                    gpui_gxserver_rpc_result("/api/agentAccounts", &params, timeout)
                                }
                            }
                        })
                        .await
                }
                Err(error) => Err(error),
            };
            let (outcome, message) = match result {
                Ok(value) => (
                    value["outcome"].as_str().unwrap_or("failed").to_string(),
                    value["message"].as_str().unwrap_or("").to_string(),
                ),
                Err(error) => (
                    "failed".to_string(),
                    super::account_usage::account_display_text(&error),
                ),
            };
            let _ = this.update(cx, |this, cx| {
                this.titlebar_accounts_revision = this.titlebar_accounts_revision.wrapping_add(1);
                this.refresh_titlebar_accounts(cx);
            });
            let _ = panel.update(cx, |panel, cx| panel.finish_claim(&outcome, message, cx));
        })
        .detach();
    }
}
