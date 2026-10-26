@mobile
Feature: Smartphone controls
  In portrait mode the board is on top and a collapsible menu sits at the bottom.

  Background:
    Given Anna and Ben play a game in Switzerland
    And it is Anna's turn

  Scenario: The menu can be expanded and the tabs switched
    Then the menu for Anna is collapsed
    When Anna expands the menu
    Then the menu for Anna is expanded
    When Anna switches to the tab "Besitz" in the menu
    Then the tab for Anna shows the text "Du besitzt noch nichts"
    When Anna switches to the tab "Handel" in the menu
    Then the tab for Anna shows the text "Keine Angebote"
    When Anna switches to the tab "Spieler" in the menu
    Then the tab for Anna shows the text "Ben"
    When Anna collapses the menu
    Then the menu for Anna is collapsed

  Scenario: The property card opens as a full-screen sheet
    Given Anna already owns "Weggisgasse"
    When Anna opens the property card of "Weggisgasse"
    Then the property card for Anna fills the whole screen
    And the property card for Anna shows the owner "Anna"
    When Anna closes the property card
    Then the menu for Anna is expanded

  Scenario: Rolling by tapping
    Given the dice sequence is 2+4
    When Anna rolls by tapping
    Then Anna is offered the chance to buy "Weggisgasse"
