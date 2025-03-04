import Models
import Services
import SwiftUI
import Utils
import Views

struct WelcomeView: View {
  @EnvironmentObject var dataService: DataService
  @EnvironmentObject var authenticator: Authenticator
  @Environment(\.horizontalSizeClass) var horizontalSizeClass
  @Environment(\.openURL) var openURL

  @StateObject private var viewModel = RegistrationViewModel()

  @State private var showRegistrationView = false
  @State private var showDebugModal = false
  @State private var showTermsLinks = false
  @State private var showTermsModal = false
  @State private var showPrivacyModal = false
  @State private var showEmailLoginModal = false
  @State private var showAdvancedLogin = false
  @State private var showAboutPage = false
  @State private var selectedEnvironment = AppEnvironment.initialAppEnvironment
  @State private var containerSize: CGSize = .zero

  // swiftlint:disable:next line_length
  let deletedAccountConfirmationMessage = "Your account has been deleted. Additional steps may be needed if Sign in with Apple was used to register."

  func handleHiddenGestureAction() {
    if !Bundle.main.isAppStoreBuild {
      showDebugModal = true
    }
  }

  var headlineText: some View {
    Text(LocalText.welcomeTitle)
      .font(.appLargeTitle)
      .fixedSize(horizontal: false, vertical: true)
  }

  var headlineView: some View {
    VStack(alignment: .leading, spacing: 8) {
      headlineText

      Button(
        action: {
          #if os(iOS)
            showAboutPage = true
          #else
            if let url = URL(string: "https://omnivore.app/about") {
              NSWorkspace.shared.open(url)
            }
          #endif
        },
        label: {
          HStack(spacing: 4) {
            Text(LocalText.welcomeLearnMore)
            Image(systemName: "arrow.right")
          }
          .font(.appTitleThree)
        }
      )
      .foregroundColor(.appGrayTextContrast)
      #if os(macOS)
        .buttonStyle(PlainButtonStyle())
      #endif
    }
  }

  var footerView: some View {
    Group {
      Text(LocalText.welcomeSignupAgreement)
        + Text(LocalText.welcomeTitleTermsOfService).underline()
        + Text(LocalText.welcomeTitleAndJoiner)
        + Text(LocalText.privacyPolicyGeneric).underline()
    }
    .font(.appSubheadline)
    .fixedSize(horizontal: false, vertical: true)
    .confirmationDialog("", isPresented: $showTermsLinks, titleVisibility: .hidden) {
      Button("View Terms of Service") {
        showTermsModal = true
      }

      Button("View Privacy Policy") {
        showPrivacyModal = true
      }

      Spacer()
    }
    .sheet(isPresented: $showPrivacyModal) {
      VStack {
        HStack {
          Spacer()
          Button(
            action: {
              showPrivacyModal = false
            },
            label: {
              Image(systemName: "xmark.circle").foregroundColor(.appGrayTextContrast)
            }
          )
        }
        .padding()
        BasicWebAppView.privacyPolicyWebView(baseURL: dataService.appEnvironment.webAppBaseURL)
      }
    }
    .sheet(isPresented: $showTermsModal) {
      VStack {
        HStack {
          Spacer()
          Button(
            action: {
              showTermsModal = false
            },
            label: {
              Image(systemName: "xmark.circle").foregroundColor(.appGrayTextContrast)
            }
          )
        }
        .padding()
        BasicWebAppView.termsConditionsWebView(baseURL: dataService.appEnvironment.webAppBaseURL)
      }
    }
    .sheet(isPresented: $showAboutPage) {
      if let url = URL(string: "https://omnivore.app/about") {
        SafariView(url: url)
      }
    }
    .onTapGesture {
      showTermsLinks = true
    }
  }

  var logoView: some View {
    Image.omnivoreTitleLogo
      .gesture(
        TapGesture(count: 2)
          .onEnded {
            if !Bundle.main.isAppStoreBuild {
              showDebugModal = true
            }
          }
      )
  }

  var authProviderButtonStack: some View {
    let useHorizontalLayout = containerSize.width > 500

    let googleButton = Group {
      if AppKeys.sharedInstance?.iosClientGoogleId != nil {
        GoogleAuthButton {
          Task {
            await viewModel.handleGoogleAuth(authenticator: authenticator)
          }
        }
      }
    }

    let appleButton = AppleSignInButton {
      viewModel.handleAppleSignInCompletion(result: $0, authenticator: authenticator)
    }

    let emailButton = Button(
      action: { showEmailLoginModal = true },
      label: {
        Text(LocalText.welcomeTitleEmailContinue)
          .font(.appHeadline)
          .foregroundColor(.appGrayTextContrast)
          .underline()
      }
    )
    .padding(.vertical)
    #if os(macOS)
      .buttonStyle(PlainButtonStyle())
    #endif

    return
      VStack(alignment: .center, spacing: 16) {
        if useHorizontalLayout {
          VStack(alignment: .leading, spacing: 0) {
            HStack {
              appleButton
              googleButton
            }
            emailButton
          }
        } else {
          VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 16) {
              appleButton
              googleButton
            }
            emailButton
          }
        }

        if let loginError = viewModel.loginError {
          HStack {
            LoginErrorMessageView(loginError: loginError)
            Spacer()
          }
        }
      }
  }

  public var body: some View {
    ZStack(alignment: viewModel.registrationState == nil ? .leading : .center) {
      Color.appBackground
        .edgesIgnoringSafeArea(.all)
        .modifier(SizeModifier())
        .onPreferenceChange(SizePreferenceKey.self) {
          self.containerSize = $0
        }
      if let registrationState = viewModel.registrationState {
        if case let RegistrationViewModel.RegistrationState.createProfile(userProfile) = registrationState {
          CreateProfileView(userProfile: userProfile)
        } else if case let RegistrationViewModel.RegistrationState.newAppleSignUp(userProfile) = registrationState {
          NewAppleSignupView(
            userProfile: userProfile,
            showProfileEditView: { viewModel.registrationState = .createProfile(userProfile: userProfile) }
          )
        } else {
          EmptyView() // will never be called
        }
      } else {
        VStack(alignment: .leading, spacing: containerSize.height < 500 ? 12 : 50) {
          logoView
          headlineView
          authProviderButtonStack
          footerView

          Spacer()

          Button(
            action: { showAdvancedLogin = true },
            label: {
              Text("Self-hosting options")
                .font(Font.appCaption)
                .foregroundColor(.appGrayTextContrast)
                .underline()
                .frame(maxWidth: .infinity, alignment: .center)
            }
          )
        }
        .padding()
        .sheet(isPresented: $showEmailLoginModal) {
          EmailAuthView()
        }
        .sheet(isPresented: $showDebugModal) {
          DebugMenuView(selectedEnvironment: $selectedEnvironment)
        }
        #if os(iOS)
          .sheet(isPresented: $showAdvancedLogin) {
            NavigationView {
              SelfHostSettingsView()
            }
          }
        #endif
        .alert(deletedAccountConfirmationMessage, isPresented: $authenticator.showAppleRevokeTokenAlert) {
          Button("View Details") {
            openURL(URL(string: "https://support.apple.com/en-us/HT210426")!)
          }
          Button(LocalText.dismissButton) { self.authenticator.showAppleRevokeTokenAlert = false }
        }
      }
    }
    .preferredColorScheme(.light)
    .task { selectedEnvironment = dataService.appEnvironment }
  }
}
