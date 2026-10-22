package io.nocturne.client.mixin;

import com.mojang.authlib.GameProfile;
import io.nocturne.client.WestronSkinManager;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.world.entity.player.PlayerSkin;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(value = AbstractClientPlayer.class, remap = false)
public abstract class AbstractClientPlayerMixin {
    @Inject(method = "getSkin", at = @At("HEAD"), cancellable = true, remap = false)
    private void westron$useCustomSkin(CallbackInfoReturnable<PlayerSkin> cir) {
        GameProfile profile = ((AbstractClientPlayer) (Object) this).getGameProfile();
        PlayerSkin skin = WestronSkinManager.getSkin(profile);
        if (skin != null) {
            cir.setReturnValue(skin);
        }
    }
}
