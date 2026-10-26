@desktop
Feature: Keyboard handling of dialogs
  Blocking overlays are native modal dialogs: the focus starts inside, Tab and Shift+Tab stay inside, Escape closes
  where closing is safe and the focus returns to the control that opened the dialog.

  Background:
    Given Anna and Ben play a game in Switzerland
    And it is Anna's turn

  Scenario: The trade dialog keeps the focus inside and gives it back
    When Anna opens the trade dialog with the keyboard
    Then the keyboard focus of Anna is inside the open dialog
    And Anna can tab 12 times without leaving the open dialog
    When Anna presses Escape
    Then the trade dialog of Anna is closed
    And the keyboard focus of Anna is on "the trade button"

  Scenario: A destructive confirmation starts on Cancel
    When Anna opens the end-game confirmation with the keyboard
    Then the keyboard focus of Anna is on "Cancel"
    And Anna can tab 6 times without leaving the open dialog
    When Anna presses Escape
    Then the end-game confirmation of Anna is closed
    And the keyboard focus of Anna is on "the menu button"

  Scenario: The device transfer dialog closes with Escape and returns the focus
    When Anna opens the device transfer dialog with the keyboard
    Then the keyboard focus of Anna is on "the close button"
    And Anna can tab 8 times without leaving the open dialog
    When Anna presses Escape
    Then the device transfer dialog of Anna is closed
    And the keyboard focus of Anna is on "the menu button"

  Scenario: The end-game vote must be answered and starts on No
    When Anna proposes ending the game
    Then Ben sees the request from Anna to end the game
    And the keyboard focus of Ben is on "No"
    When Ben presses Escape
    Then Ben still sees the request to end the game
    And Ben can tab 6 times without leaving the open dialog

  Scenario: Arrow keys move between the tabs of the log panel
    When Anna opens the log panel
    And Anna focuses the tab "Protokoll"
    And Anna presses ArrowRight
    Then the tab "Chat" of Anna is selected and focused
    And only the tab "Chat" of Anna is in the tab order and its panel is labelled by it
    When Anna presses Home
    Then the tab "Protokoll" of Anna is selected and focused
    When Anna presses End
    Then the tab "Chat" of Anna is selected and focused
