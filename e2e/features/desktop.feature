@desktop
Feature: Desktop controls
  On a large screen the player panels and the action bar always sit next to the board.

  Scenario: Player panels, action bar and property sidebar
    Given Anna and Ben play a game in Switzerland
    And Anna already owns "Weggisgasse"
    And it is Anna's turn
    Then the screen of Anna shows the players "Anna" and "Ben" side by side with their balance
    And Anna has no menu bar at the bottom
    When Anna opens her properties
    Then Anna owns "Weggisgasse"
    When Anna opens the property card of "Weggisgasse"
    Then the property card for Anna shows the owner "Anna"
