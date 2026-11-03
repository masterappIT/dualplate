//
//  ViewController.m
//  Pandora
//
//  Created by Mac Pro_C on 12-12-26.
//  Copyright (c) 2012年 __MyCompanyName__. All rights reserved.
//
#import "ViewController.h"
#import "PDRToolSystem.h"
#import "PDRToolSystemEx.h"
#import "AppDelegate.h"

@implementation ViewController

- (void)loadView
{
    PDRCore *h5Engine = [PDRCore Instance];
    [super loadView];
    [self setStatusBarStyle:h5Engine.settings.statusBarStyle];
    _isFullScreen = self.view.window.windowScene.statusBarManager.statusBarHidden;
    if ( _isFullScreen != h5Engine.settings.fullScreen ) {
        _isFullScreen = h5Engine.settings.fullScreen;
        [self setNeedsStatusBarAppearanceUpdate];
    }
    self.view.backgroundColor = [UIColor whiteColor];
    [h5Engine setContainerView:self.view];
    h5Engine.persentViewController = self;
    if ( self.showLoadingView ) {
        [h5Engine showLoadingPage];
    }
}

- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
}

#pragma mark -
- (void)willAnimateRotationToInterfaceOrientation:(UIInterfaceOrientation)toInterfaceOrientation
                                         duration:(NSTimeInterval)duration
{
    [[PDRCore Instance] handleSysEvent:PDRCoreSysEventInterfaceOrientation
                            withObject:[NSNumber numberWithInt:toInterfaceOrientation]];
    [self setNeedsStatusBarAppearanceUpdate];
}

- (BOOL)shouldAutorotate
{
    return TRUE;
}

- (UIInterfaceOrientationMask)supportedInterfaceOrientations
{
    return [[PDRCore Instance].settings supportedInterfaceOrientations];
}

- (BOOL)shouldAutorotateToInterfaceOrientation:(UIInterfaceOrientation)interfaceOrientation
{
    if ( [PDRCore Instance].settings ) {
        return [[PDRCore Instance].settings supportsOrientation:interfaceOrientation];
    }
    return UIInterfaceOrientationPortrait == interfaceOrientation;
}

- (BOOL)prefersStatusBarHidden
{
    return _isFullScreen;/*
                          NSString *model = [UIDevice currentDevice].model;
                          if (UIUserInterfaceIdiomPhone == UI_USER_INTERFACE_IDIOM()
                          && (NSOrderedSame == [@"iPad" caseInsensitiveCompare:model]
                          || NSOrderedSame == [@"iPad Simulator" caseInsensitiveCompare:model])) {
                          return YES;
                          }
                          return NO;*/
}

- (UIStatusBarAnimation)preferredStatusBarUpdateAnimation {
    return UIStatusBarAnimationFade;
}

-(BOOL)getStatusBarHidden {
    return _isFullScreen;
}

#pragma mark - StatusBarStyle
-(UIStatusBarStyle)getStatusBarStyle {
    return [self preferredStatusBarStyle];
}
-(void)setStatusBarStyle:(UIStatusBarStyle)statusBarStyle {
    if ( _statusBarStyle != statusBarStyle ) {
        _statusBarStyle = statusBarStyle;
        [self setNeedsStatusBarAppearanceUpdate];
    }
}

- (UIStatusBarStyle)preferredStatusBarStyle
{
    return _statusBarStyle;
}

#pragma mark -
-(void)wantsFullScreen:(BOOL)fullScreen
{
    if ( _isFullScreen == fullScreen ) {
        return;
    }

    _isFullScreen = fullScreen;
    [self setNeedsStatusBarAppearanceUpdate];
}

- (void)didReceiveMemoryWarning{
    [[PDRCore Instance] handleSysEvent:PDRCoreSysEventReceiveMemoryWarning withObject:nil];
}

- (void)dealloc {
}
@end
