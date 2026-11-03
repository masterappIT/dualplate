#import "SceneDelegate.h"
#import "AppDelegate.h"
#import "PDRCore.h"

@interface SceneDelegate ()
- (void)handleConnectionOptions:(UISceneConnectionOptions *)connectionOptions;
@end

@implementation SceneDelegate

- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
              options:(UISceneConnectionOptions *)connectionOptions
{
    if (![scene isKindOfClass:[UIWindowScene class]]) {
        return;
    }

    self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
    AppDelegate *appDelegate = (AppDelegate *)UIApplication.sharedApplication.delegate;
    [appDelegate configureWindow:self.window];
    [self handleConnectionOptions:connectionOptions];
}

- (void)sceneDidBecomeActive:(UIScene *)scene
{
    [PDRCore handleSysEvent:PDRCoreSysEventBecomeActive withObject:nil];
}

- (void)sceneWillResignActive:(UIScene *)scene
{
    [PDRCore handleSysEvent:PDRCoreSysEventResignActive withObject:nil];
}

- (void)sceneDidEnterBackground:(UIScene *)scene
{
    [PDRCore handleSysEvent:PDRCoreSysEventEnterBackground withObject:nil];
}

- (void)sceneWillEnterForeground:(UIScene *)scene
{
    [PDRCore handleSysEvent:PDRCoreSysEventEnterForeGround withObject:nil];
}

- (void)scene:(UIScene *)scene openURLContexts:(NSSet<UIOpenURLContext *> *)URLContexts
{
    for (UIOpenURLContext *context in URLContexts) {
        NSMutableDictionary<UIApplicationOpenURLOptionsKey, id> *options = [NSMutableDictionary dictionary];
        if (context.options.sourceApplication) {
            options[UIApplicationOpenURLOptionsSourceApplicationKey] = context.options.sourceApplication;
        }
        if (context.options.annotation) {
            options[UIApplicationOpenURLOptionsAnnotationKey] = context.options.annotation;
        }
        options[UIApplicationOpenURLOptionsOpenInPlaceKey] = @(context.options.openInPlace);
        [PDRCore handleSysEvent:PDRCoreSysEventOpenURLWithOptions withObject:@[context.URL, options]];
    }
}

- (void)scene:(UIScene *)scene continueUserActivity:(NSUserActivity *)userActivity
{
    [PDRCore handleSysEvent:PDRCoreSysEventContinueUserActivity withObject:userActivity];
}

- (void)windowScene:(UIWindowScene *)windowScene
performActionForShortcutItem:(UIApplicationShortcutItem *)shortcutItem
  completionHandler:(void (^)(BOOL succeeded))completionHandler
{
    [PDRCore handleSysEvent:PDRCoreSysEventPeekQuickAction withObject:shortcutItem];
    completionHandler(YES);
}

- (void)handleConnectionOptions:(UISceneConnectionOptions *)connectionOptions
{
    dispatch_async(dispatch_get_main_queue(), ^{
        if (connectionOptions.shortcutItem) {
            [PDRCore handleSysEvent:PDRCoreSysEventPeekQuickAction withObject:connectionOptions.shortcutItem];
        }
        if (connectionOptions.URLContexts.count > 0) {
            [self scene:self.window.windowScene openURLContexts:connectionOptions.URLContexts];
        }
        for (NSUserActivity *activity in connectionOptions.userActivities) {
            [PDRCore handleSysEvent:PDRCoreSysEventContinueUserActivity withObject:activity];
        }
    });
}

@end
